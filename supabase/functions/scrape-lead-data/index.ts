// Scrapes a lead's existing site with Firecrawl. Strategy:
// 1. Find the working root URL (try https/http × www variants).
// 2. Map the site to discover subpages.
// 3. Pick ONLY the home page + best "om oss" + best "tjänster" page (sv+en aliases).
// 4. Scrape each of those pages individually and store them under scraped_content.pages.
// Fails fast if the root page looks like an HTTP error or is nearly empty.
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

    // ---- 1. Find a working root URL by scraping variants ----
    const candidates = buildUrlCandidates(site.source_url)
    const attempts: { url: string; status: number; title?: string }[] = []
    let rootScrape: any = null
    let usedUrl = site.source_url

    for (const candidate of candidates) {
      const { data, status, title } = await scrapeOne(candidate, fcKey)
      attempts.push({ url: candidate, status, title: (title || '').slice(0, 60) })
      const badTitle = /(400|401|403|404|500|502|503|504)\s*(bad request|unauthorized|forbidden|not found|error|gateway|unavailable)|access denied|cloudflare|attention required/i
      const looksBad = (status && status >= 400) || badTitle.test(title || '')
      if (data && !looksBad && (data.markdown || '').trim().length > 300) {
        rootScrape = data
        usedUrl = candidate
        break
      }
    }

    if (!rootScrape) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `Root page failed on all variants: ${attempts.map(a => `${a.url}→${a.status}`).join(', ')}`,
      }).eq('id', generated_site_id)
      return json({ error: 'root scrape failed', attempts }, 422)
    }

    // ---- 2. Map the site to discover subpages ----
    let allLinks: string[] = []
    try {
      const mapResp = await fetch(`${FIRECRAWL_V2}/map`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: usedUrl, limit: 200, includeSubdomains: false }),
      })
      const mapJson = await mapResp.json()
      allLinks = (mapJson?.links ?? mapJson?.data?.links ?? []).map((l: any) => typeof l === 'string' ? l : l?.url).filter(Boolean)
    } catch (_) { /* map is best-effort */ }

    // Fallback: use links from root page if map returned nothing
    if (allLinks.length === 0 && Array.isArray(rootScrape.links)) {
      allLinks = rootScrape.links
    }

    // ---- 3. Pick best about + services page ----
    const aboutUrl = pickBestUrl(allLinks, usedUrl, [
      /\/(om[-_ ]?oss|om[-_ ]?foretaget|about|about[-_ ]?us|company|foretaget)(\/|$|\.)/i,
      /\/(om|about)(\/|$|\.)/i,
    ])
    const servicesUrl = pickBestUrl(allLinks, usedUrl, [
      /\/(tjanster|tjänster|vara[-_ ]?tjanster|våra[-_ ]?tjänster|services|service|verkstad|erbjudanden|behandlingar)(\/|$|\.)/i,
      /\/(services|service|tjanster|tjänster)(\/|$|\.)/i,
    ])

    // ---- 4. Scrape about + services individually ----
    const pages: Record<string, any> = {
      home: normalizePage(rootScrape, usedUrl),
    }
    if (aboutUrl && aboutUrl !== usedUrl) {
      const r = await scrapeOne(aboutUrl, fcKey)
      if (r.data && (r.data.markdown || '').trim().length > 150) pages.about = normalizePage(r.data, aboutUrl)
    }
    if (servicesUrl && servicesUrl !== usedUrl && servicesUrl !== aboutUrl) {
      const r = await scrapeOne(servicesUrl, fcKey)
      if (r.data && (r.data.markdown || '').trim().length > 150) pages.services = normalizePage(r.data, servicesUrl)
    }

    // Aggregate images across all scraped pages
    const allImages = new Set<string>()
    Object.values(pages).forEach((p: any) => (p.images || []).forEach((i: string) => allImages.add(i)))

    const scraped = {
      title: rootScrape.metadata?.title ?? '',
      description: rootScrape.metadata?.description ?? '',
      summary: rootScrape.summary ?? '',
      branding: rootScrape.branding ?? null,
      source_url_used: usedUrl,
      discovered_about_url: aboutUrl,
      discovered_services_url: servicesUrl,
      pages,                              // { home, about?, services? } each with { url, title, markdown, images }
      images: Array.from(allImages).slice(0, 20),
      scraped_at: new Date().toISOString(),
    }

    await supabase.from('generated_sites').update({
      status: 'scraped',
      scraped_content: scraped,
    }).eq('id', generated_site_id)

    return json({
      ok: true,
      pages_scraped: Object.keys(pages),
      about_url: aboutUrl,
      services_url: servicesUrl,
      total_chars: Object.values(pages).reduce((sum: number, p: any) => sum + (p.markdown?.length || 0), 0),
    })
  } catch (err) {
    console.error('scrape-lead-data error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

async function scrapeOne(url: string, fcKey: string): Promise<{ data: any | null; status: number; title: string }> {
  try {
    const r = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'links', 'branding', 'summary'],
        onlyMainContent: true,
      }),
    })
    const j = await r.json()
    const payload = j?.data ?? j
    const status = payload?.metadata?.statusCode ?? payload?.metadata?.status_code ?? r.status
    const title = payload?.metadata?.title ?? ''
    if (!r.ok) return { data: null, status, title }
    return { data: payload, status, title }
  } catch (_) {
    return { data: null, status: 0, title: '' }
  }
}

function normalizePage(payload: any, url: string) {
  const md: string = payload.markdown ?? ''
  const imgs = new Set<string>()
  const re = /!\[[^\]]*\]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    if (m[1] && /^https?:\/\//.test(m[1])) imgs.add(m[1])
  }
  if (payload.branding?.images) {
    Object.values(payload.branding.images).forEach((v) => typeof v === 'string' && imgs.add(v))
  }
  return {
    url,
    title: payload.metadata?.title ?? '',
    description: payload.metadata?.description ?? '',
    summary: payload.summary ?? '',
    markdown: md,
    images: Array.from(imgs).slice(0, 12),
  }
}

function pickBestUrl(links: string[], rootUrl: string, patterns: RegExp[]): string | null {
  if (!links.length) return null
  let rootHost = ''
  try { rootHost = new URL(rootUrl).hostname.replace(/^www\./, '') } catch (_) { /* ignore */ }
  const sameDomain = links.filter((l) => {
    try { return new URL(l).hostname.replace(/^www\./, '') === rootHost } catch (_) { return false }
  })
  for (const pat of patterns) {
    const hit = sameDomain.find((l) => pat.test(l))
    if (hit) return hit
  }
  return null
}

function buildUrlCandidates(raw: string): string[] {
  const cleaned = raw.trim().replace(/\/+$/, '')
  const host = cleaned.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  if (!host) return [cleaned]
  const bare = host.replace(/^www\./i, '')
  const withWww = `www.${bare}`
  const out = new Set<string>()
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
