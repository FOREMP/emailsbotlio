// Scrapes a lead's existing site with Firecrawl.
// 1. Find working root URL (https/http × www variants).
// 2. Map the site to discover subpages.
// 3. Pick best "om oss" + best "tjänster" page from prioritized slug lists (sv + en).
// 4. Scrape home + about + services individually.
// 5. Capture a screenshot of the home page (design inspo for the generator).
// 6. Persist full branding palette + fonts.
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  activePipelineBreakers,
  pipelineErrorCode,
  pipelinePausedPayload,
  recordPipelineFailure,
} from '../_shared/site-pipeline-health.ts'
import { mapUrl, scrapeUrl, selectedScrapeProvider, ScraperError } from '../_shared/scraper-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Ordered slug fallback lists. First hit wins.
const ABOUT_SLUGS = [
  'om-oss', 'omoss', 'om_oss', 'om',
  'om-foretaget', 'omforetaget', 'foretaget', 'foretag',
  'historia', 'var-historia', 'vilka-vi-ar', 'vilka-ar-vi',
  'info', 'information', 'kontakt-info',
  'about', 'about-us', 'aboutus', 'company', 'who-we-are', 'our-story', 'story',
]
const SERVICES_SLUGS = [
  'tjanster', 'tjänster', 'vara-tjanster', 'våra-tjänster', 'vara_tjanster',
  'service', 'services', 'servicetjanster',
  'verkstad', 'verkstadstjanster', 'bilservice',
  'reparation', 'reparationer', 'bilreparation',
  'erbjudanden', 'sortiment', 'produkter',
  'vad-vi-gor', 'what-we-do', 'offerings', 'solutions',
]

interface ScrapeRequest { generated_site_id: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { generated_site_id }: ScrapeRequest = await req.json()
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const provider = await selectedScrapeProvider(supabase)
    const breakers = await activePipelineBreakers(supabase, [provider, 'openrouter', 'vercel'])
    if (breakers.length) return json(pipelinePausedPayload(breakers), 423)

    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, source_url, contact_id, site_lead_id')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)
    if (!site.source_url) return json({ error: 'no source_url — run audit first' }, 400)

    await supabase.from('generated_sites').update({ status: 'scraping', error_message: null }).eq('id', generated_site_id)

    // ---- 1. Find a working root URL by scraping variants (with screenshot) ----
    const candidates = buildUrlCandidates(site.source_url)
    const attempts: { url: string; status: number; apiStatus: number; provider: 'firecrawl' | 'botlio_scraper'; title?: string; error?: string }[] = []
    let rootScrape: any = null
    let usedUrl = site.source_url

    for (const candidate of candidates) {
      const { data, status, apiStatus, provider: providerUsed, title, error } = await scrapeOne(provider, candidate, true)
      attempts.push({ url: candidate, status, apiStatus, provider: providerUsed, title: (title || '').slice(0, 60), error })
      const badTitle = /(400|401|403|404|500|502|503|504)\s*(bad request|unauthorized|forbidden|not found|error|gateway|unavailable)|access denied|cloudflare|attention required/i
      const looksBad = (status && status >= 400) || badTitle.test(title || '')
      if (data && !looksBad && (data.markdown || '').trim().length > 300) {
        rootScrape = data
        usedUrl = candidate
        break
      }
    }

    if (!rootScrape) {
      const providerFailure = attempts.find((attempt) =>
        [401, 402, 429].includes(attempt.apiStatus) || attempt.apiStatus >= 500
      )
      if (providerFailure) {
        const message = providerFailure.error || `${provider} failed with HTTP ${providerFailure.apiStatus}`
        const failedProvider = providerFailure.provider ?? provider
        const errorCode = pipelineErrorCode(failedProvider, providerFailure.apiStatus, message)
        const incident = await recordPipelineFailure(supabase, {
          provider: failedProvider, sourceFunction: 'scrape-lead-data', message,
          httpStatus: providerFailure.apiStatus, siteLeadId: site.site_lead_id ?? null,
          generatedSiteId: generated_site_id,
        })
        await supabase.from('generated_sites').update({
          status: 'failed', error_message: `${failedProvider} ${errorCode}: ${message}`,
        }).eq('id', generated_site_id)
        return json({ error: message, provider: failedProvider, error_code: errorCode, pipeline_paused: incident.isPaused }, providerFailure.apiStatus === 402 ? 402 : 503)
      }
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `Root page failed on all variants: ${attempts.map(a => `${a.url}→${a.status}`).join(', ')}`,
      }).eq('id', generated_site_id)
      return json({ error: 'root scrape failed', attempts }, 422)
    }

    // ---- 2. Map the site to discover subpages ----
    let allLinks: string[] = []
    try {
      allLinks = await mapUrl(provider, usedUrl)
    } catch (_) { /* map is best-effort */ }

    if (allLinks.length === 0 && Array.isArray(rootScrape.links)) {
      allLinks = rootScrape.links
    }

    // ---- 3. Pick best about + services via ordered slug lists ----
    const aboutUrl = pickBySlugList(allLinks, usedUrl, ABOUT_SLUGS)
    const servicesUrl = pickBySlugList(allLinks, usedUrl, SERVICES_SLUGS)

    // ---- 4. Scrape about + services individually ----
    const pages: Record<string, any> = {
      home: normalizePage(rootScrape, usedUrl),
    }
    if (aboutUrl && aboutUrl !== usedUrl) {
      const r = await scrapeOne(provider, aboutUrl, false)
      if (r.data && (r.data.markdown || '').trim().length > 150) pages.about = normalizePage(r.data, aboutUrl)
    }
    if (servicesUrl && servicesUrl !== usedUrl && servicesUrl !== aboutUrl) {
      const r = await scrapeOne(provider, servicesUrl, false)
      if (r.data && (r.data.markdown || '').trim().length > 150) pages.services = normalizePage(r.data, servicesUrl)
    }

    // Aggregate images across all scraped pages
    const allImages = new Set<string>()
    Object.values(pages).forEach((p: any) => (p.images || []).forEach((i: string) => allImages.add(i)))

    // Screenshot URL — Firecrawl returns it under payload.screenshot (or in metadata)
    const screenshotUrl: string | null = rootScrape.screenshot
      ?? rootScrape.metadata?.screenshot
      ?? null

    const scraped = {
      provider_used: rootScrape.provider_used ?? provider,
      fallback_from: rootScrape.fallback_from ?? null,
      title: rootScrape.metadata?.title ?? '',
      description: rootScrape.metadata?.description ?? '',
      summary: rootScrape.summary ?? '',
      branding: rootScrape.branding ?? null,
      screenshot_url: screenshotUrl,
      source_url_used: usedUrl,
      discovered_about_url: aboutUrl,
      discovered_services_url: servicesUrl,
      pages,
      images: Array.from(allImages).slice(0, 20),
      scraped_at: new Date().toISOString(),
    }

    // Only advance if this invocation still owns the scrape step. Older/duplicate
    // scrape invocations must not overwrite a row that already moved on to
    // queued/processing/generated/live.
    await supabase.from('generated_sites').update({
      status: 'scraped',
      scraped_content: scraped,
    }).eq('id', generated_site_id).eq('status', 'scraping')

    return json({
      ok: true,
      provider_used: rootScrape.provider_used ?? provider,
      fallback_from: rootScrape.fallback_from ?? null,
      pages_scraped: Object.keys(pages),
      about_url: aboutUrl,
      services_url: servicesUrl,
      screenshot: !!screenshotUrl,
      branding_colors: !!(rootScrape.branding?.colors),
      total_chars: Object.values(pages).reduce((sum: number, p: any) => sum + (p.markdown?.length || 0), 0),
    })
  } catch (err) {
    console.error('scrape-lead-data error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

async function scrapeOne(provider: 'firecrawl' | 'botlio_scraper', url: string, includeScreenshot: boolean): Promise<{ data: any | null; status: number; apiStatus: number; provider: 'firecrawl' | 'botlio_scraper'; title: string; error: string }> {
  try {
    const payload = await scrapeUrl(provider, url, { screenshot: includeScreenshot })
    const status = payload?.metadata?.statusCode ?? 200
    const title = payload?.metadata?.title ?? ''
    return { data: payload, status, apiStatus: 200, provider: payload.provider_used ?? provider, title, error: '' }
  } catch (error) {
    const typed = error instanceof ScraperError ? error : null
    return { data: null, status: typed?.status ?? 0, apiStatus: typed?.status ?? 0, provider: typed?.provider ?? provider, title: '', error: error instanceof Error ? error.message : String(error) }
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

function pickBySlugList(links: string[], rootUrl: string, slugs: string[]): string | null {
  if (!links.length) return null
  let rootHost = ''
  try { rootHost = new URL(rootUrl).hostname.replace(/^www\./, '') } catch (_) { /* ignore */ }
  const sameDomain = links.filter((l) => {
    try { return new URL(l).hostname.replace(/^www\./, '') === rootHost } catch (_) { return false }
  })
  for (const slug of slugs) {
    // Match /slug, /slug/, /slug.html at end of path
    const pat = new RegExp(`/${escapeRegex(slug)}(/|$|\\.html?$)`, 'i')
    const hit = sameDomain.find((l) => {
      try { return pat.test(new URL(l).pathname) } catch (_) { return false }
    })
    if (hit) return hit
  }
  return null
}

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

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
