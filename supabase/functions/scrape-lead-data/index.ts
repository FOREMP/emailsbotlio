// Scrapes a lead's existing website with Firecrawl and stores the raw content
// + branding + images in generated_sites.scraped_content. Fails fast if the
// scrape returned an error page or too little real content — so we don't
// generate a hallucinated site on top of "400 Bad Request".
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2'

interface ScrapeRequest {
  generated_site_id: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { generated_site_id }: ScrapeRequest = await req.json()
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, source_url, contact_id')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)
    if (!site.source_url) return json({ error: 'no source_url — run audit first' }, 400)

    await supabase.from('generated_sites').update({ status: 'scraping', error_message: null }).eq('id', generated_site_id)

    const fcKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!fcKey) return json({ error: 'FIRECRAWL_API_KEY missing' }, 500)

    // Try several URL variants — many small business sites 400 on the wrong host/scheme
    const candidates = buildUrlCandidates(site.source_url)
    let fcResp: Response | null = null
    let fcData: any = null
    let usedUrl = site.source_url
    const attempts: { url: string; status: number; title?: string }[] = []

    for (const candidate of candidates) {
      const r = await fetch(`${FIRECRAWL_V2}/scrape`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: candidate,
          formats: ['markdown', 'links', 'branding', 'summary'],
          onlyMainContent: true,
        }),
      })
      const d = await r.json()
      const payloadPeek = d?.data ?? d
      const sc: number | undefined = payloadPeek?.metadata?.statusCode ?? payloadPeek?.metadata?.status_code
      const title: string = payloadPeek?.metadata?.title ?? ''
      attempts.push({ url: candidate, status: sc ?? r.status, title: title.slice(0, 60) })
      if (r.ok && (!sc || sc < 400)) {
        fcResp = r; fcData = d; usedUrl = candidate
        break
      }
      fcResp = r; fcData = d; usedUrl = candidate
    }

    if (!fcResp!.ok) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `Scrape failed on all URL variants. Attempts: ${JSON.stringify(attempts).slice(0, 400)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'scrape failed', attempts, details: fcData }, fcResp!.status)
    }

    const payload = fcData.data ?? fcData
    const title: string = payload.metadata?.title ?? ''
    const statusCode: number | undefined = payload.metadata?.statusCode ?? payload.metadata?.status_code
    const markdown: string = payload.markdown ?? ''

    // Fail fast on obvious error pages / empty scrapes so generator doesn't hallucinate
    const badTitleRe = /(400|401|403|404|500|502|503|504)\s*(bad request|unauthorized|forbidden|not found|error|gateway|unavailable)|access denied|cloudflare|attention required/i
    const looksLikeErrorPage =
      (statusCode && statusCode >= 400) ||
      badTitleRe.test(title) ||
      badTitleRe.test(markdown.slice(0, 500))
    const tooShort = markdown.trim().length < 400

    if (looksLikeErrorPage || tooShort) {
      const reason = looksLikeErrorPage
        ? `Source site returned an error page on all variants (tried: ${attempts.map(a => `${a.url}→${a.status}`).join(', ')}). Fix source_url or skip this lead.`
        : `Source site returned too little content (${markdown.trim().length} chars). Cannot generate a meaningful demo.`
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: reason,
        scraped_content: { title, statusCode, markdown_preview: markdown.slice(0, 500), scraped_at: new Date().toISOString(), attempts },
      }).eq('id', generated_site_id)
      return json({ error: reason, attempts }, 422)
    }

    const scraped = {
      title,
      description: payload.metadata?.description,
      summary: payload.summary,
      markdown,
      links: (payload.links ?? []).slice(0, 100),
      branding: payload.branding ?? null,
      images: extractImages(payload),
      source_url_used: usedUrl,
      scraped_at: new Date().toISOString(),
    }

    await supabase.from('generated_sites').update({
      status: 'scraped',
      scraped_content: scraped,
    }).eq('id', generated_site_id)

    return json({ ok: true, chars: markdown.length, links: scraped.links.length })
  } catch (err) {
    console.error('scrape-lead-data error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

function buildUrlCandidates(raw: string): string[] {
  const cleaned = raw.trim().replace(/\/+$/, '')
  let host = cleaned.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  if (!host) return [cleaned]
  const bare = host.replace(/^www\./i, '')
  const withWww = `www.${bare}`
  const out = new Set<string>()
  // Prefer original first
  out.add(cleaned.startsWith('http') ? cleaned : `https://${bare}`)
  out.add(`https://${bare}`)
  out.add(`https://${withWww}`)
  out.add(`http://${bare}`)
  out.add(`http://${withWww}`)
  return Array.from(out)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function extractImages(payload: any): string[] {
  const images = new Set<string>()
  const md: string = payload.markdown ?? ''
  const re = /!\[[^\]]*\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    if (m[1] && /^https?:\/\//.test(m[1])) images.add(m[1])
  }
  if (payload.branding?.images) {
    Object.values(payload.branding.images).forEach((v) => typeof v === 'string' && images.add(v))
  }
  return Array.from(images).slice(0, 20)
}
