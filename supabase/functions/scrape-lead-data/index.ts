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

    const fcResp = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: site.source_url,
        formats: ['markdown', 'links', 'branding', 'summary'],
        onlyMainContent: true,
      }),
    })
    const fcData = await fcResp.json()
    if (!fcResp.ok) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `Scrape failed (${fcResp.status}): ${JSON.stringify(fcData).slice(0, 400)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'scrape failed', details: fcData }, fcResp.status)
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
        ? `Source site returned an error page (title: "${title.slice(0, 80)}"${statusCode ? `, status ${statusCode}` : ''}). Cannot generate — fix source_url or skip this lead.`
        : `Source site returned too little content (${markdown.trim().length} chars). Cannot generate a meaningful demo.`
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: reason,
        scraped_content: { title, statusCode, markdown_preview: markdown.slice(0, 500), scraped_at: new Date().toISOString() },
      }).eq('id', generated_site_id)
      return json({ error: reason }, 422)
    }

    const scraped = {
      title,
      description: payload.metadata?.description,
      summary: payload.summary,
      markdown,
      links: (payload.links ?? []).slice(0, 100),
      branding: payload.branding ?? null,
      images: extractImages(payload),
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
