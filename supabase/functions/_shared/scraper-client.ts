// One provider boundary for every website scrape. Firecrawl remains the default
// until an operator explicitly selects the self-hosted Botlio scraper.

export type ScrapeProvider = 'firecrawl' | 'botlio_scraper'

export type ScraperPayload = {
  metadata?: { title?: string; description?: string; statusCode?: number }
  markdown?: string
  links?: string[]
  summary?: string
  branding?: { colors?: string[]; fonts?: string[]; images?: string[] } | null
  screenshot?: string | null
  source_url_used?: string
  provider_used?: ScrapeProvider
  fallback_from?: ScrapeProvider
}

export class ScraperError extends Error {
  constructor(
    message: string,
    readonly provider: ScrapeProvider,
    readonly status = 0,
    readonly retryable = false,
  ) { super(message) }
}

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2'

export async function selectedScrapeProvider(supabase: any): Promise<ScrapeProvider> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'site_scrape_provider')
    .maybeSingle()
  if (error) {
    console.error('site_scrape_provider read failed; keeping Firecrawl default', error)
    return 'firecrawl'
  }
  if ((data?.value as any)?.provider !== 'botlio_scraper') return 'firecrawl'

  // A selected provider is a preference, not permission to stop the whole
  // pipeline. If the worker is not configured (or its circuit is open), use
  // Firecrawl immediately instead of producing a batch of identical failures.
  const workerUrl = String(Deno.env.get('SCRAPER_WORKER_URL') ?? '').trim()
  const workerSecret = Deno.env.get('SCRAPER_SHARED_SECRET') ?? Deno.env.get('SCRAPER_WORKER_SECRET')
  if (!workerUrl || !workerSecret) {
    console.warn('Botlio scraper selected but worker secrets are incomplete; using Firecrawl')
    return 'firecrawl'
  }

  const { data: breaker, error: breakerError } = await supabase
    .from('site_pipeline_breakers')
    .select('is_paused')
    .eq('provider', 'botlio_scraper')
    .maybeSingle()
  if (breakerError) console.warn('Botlio scraper breaker read failed; trying worker normally', breakerError)
  if (breaker?.is_paused) {
    console.warn('Botlio scraper circuit is paused; using Firecrawl')
    return 'firecrawl'
  }
  return 'botlio_scraper'
}

export async function scrapeUrl(
  provider: ScrapeProvider,
  url: string,
  options: { screenshot?: boolean } = {},
): Promise<ScraperPayload> {
  if (provider === 'firecrawl') {
    return markProvider(await scrapeWithFirecrawl(url, options), 'firecrawl')
  }

  try {
    return markProvider(await scrapeWithBotlioWorker(url, options), 'botlio_scraper')
  } catch (primaryError) {
    const primary = asScraperError(primaryError, 'botlio_scraper')
    console.warn(`Botlio scraper failed (${primary.status}): ${primary.message}; trying Firecrawl fallback`)
    try {
      return markProvider(await scrapeWithFirecrawl(url, options), 'firecrawl', 'botlio_scraper')
    } catch (fallbackError) {
      throw combinedFailure(primary, asScraperError(fallbackError, 'firecrawl'))
    }
  }
}

export async function mapUrl(provider: ScrapeProvider, url: string): Promise<string[]> {
  if (provider === 'botlio_scraper') {
    try {
      const data = await scrapeWithBotlioWorker(url, { screenshot: false })
      return cleanLinks(data.links)
    } catch (primaryError) {
      const primary = asScraperError(primaryError, 'botlio_scraper')
      console.warn(`Botlio map failed (${primary.status}): ${primary.message}; trying Firecrawl fallback`)
      try {
        return await mapWithFirecrawl(url)
      } catch (fallbackError) {
        throw combinedFailure(primary, asScraperError(fallbackError, 'firecrawl'))
      }
    }
  }

  return mapWithFirecrawl(url)
}

async function mapWithFirecrawl(url: string): Promise<string[]> {
  const key = Deno.env.get('FIRECRAWL_API_KEY')
  if (!key) throw new ScraperError('FIRECRAWL_API_KEY missing', 'firecrawl', 503, false)
  let response: Response
  try {
    response = await fetchWithTimeout(`${FIRECRAWL_V2}/map`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, limit: 200, includeSubdomains: false }),
    }, 25_000)
  } catch (error) {
    throw new ScraperError(errorMessage(error), 'firecrawl', 0, true)
  }
  const body = await safeJson(response)
  if (!response.ok) throw providerError('firecrawl', response.status, body)
  const links = body?.links ?? body?.data?.links ?? []
  return links.map((value: any) => typeof value === 'string' ? value : value?.url).filter((value: unknown): value is string => typeof value === 'string')
}

function cleanLinks(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function markProvider(payload: ScraperPayload, provider: ScrapeProvider, fallbackFrom?: ScrapeProvider): ScraperPayload {
  return { ...payload, provider_used: provider, ...(fallbackFrom ? { fallback_from: fallbackFrom } : {}) }
}

function asScraperError(error: unknown, provider: ScrapeProvider): ScraperError {
  return error instanceof ScraperError
    ? error
    : new ScraperError(errorMessage(error), provider, 0, true)
}

function combinedFailure(primary: ScraperError, fallback: ScraperError): ScraperError {
  return new ScraperError(
    `Primary ${primary.provider} failed: ${primary.message}; Firecrawl fallback failed: ${fallback.message}`.slice(0, 900),
    fallback.provider,
    fallback.status || primary.status,
    primary.retryable || fallback.retryable,
  )
}

async function scrapeWithFirecrawl(url: string, options: { screenshot?: boolean }): Promise<ScraperPayload> {
  const key = Deno.env.get('FIRECRAWL_API_KEY')
  if (!key) throw new ScraperError('FIRECRAWL_API_KEY missing', 'firecrawl', 503, false)
  const formats: any[] = ['markdown', 'links', 'branding', 'summary']
  if (options.screenshot) formats.push({ type: 'screenshot', fullPage: false })
  let response: Response
  try {
    response = await fetchWithTimeout(`${FIRECRAWL_V2}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats, onlyMainContent: true }),
    }, options.screenshot ? 75_000 : 35_000)
  } catch (error) {
    throw new ScraperError(errorMessage(error), 'firecrawl', 0, true)
  }
  const body = await safeJson(response)
  if (!response.ok) throw providerError('firecrawl', response.status, body)
  const payload = body?.data ?? body ?? {}
  return { ...payload, screenshot: payload?.screenshot ?? payload?.metadata?.screenshot ?? null }
}

async function scrapeWithBotlioWorker(url: string, options: { screenshot?: boolean }): Promise<ScraperPayload> {
  const baseUrl = String(Deno.env.get('SCRAPER_WORKER_URL') ?? '').replace(/\/$/, '')
  // The worker itself uses SCRAPER_SHARED_SECRET. Prefer that same name in
  // Supabase so one value can be copied between the two systems, while still
  // accepting the earlier SCRAPER_WORKER_SECRET name for backward compatibility.
  const secret = Deno.env.get('SCRAPER_SHARED_SECRET') ?? Deno.env.get('SCRAPER_WORKER_SECRET')
  if (!baseUrl || !secret) throw new ScraperError('SCRAPER_WORKER_URL or SCRAPER_SHARED_SECRET missing', 'botlio_scraper', 503, false)
  if (!/^https:\/\//i.test(baseUrl)) throw new ScraperError('SCRAPER_WORKER_URL must use HTTPS', 'botlio_scraper', 503, false)

  const body = JSON.stringify({ url, screenshot: Boolean(options.screenshot) })
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = await sign(`${timestamp}.${body}`, secret)
  let response: Response
  try {
    response = await fetchWithTimeout(`${baseUrl}/v1/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Botlio-Timestamp': timestamp,
        'X-Botlio-Signature': signature,
      },
      body,
    }, options.screenshot ? 75_000 : 35_000)
  } catch (error) {
    throw new ScraperError(errorMessage(error), 'botlio_scraper', 0, true)
  }
  const result = await safeJson(response)
  if (!response.ok || !result?.ok) throw providerError('botlio_scraper', response.status, result)
  return result.data ?? {}
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function providerError(provider: ScrapeProvider, status: number, body: any): ScraperError {
  const message = String(body?.error ?? body?.message ?? `${provider} returned HTTP ${status}`).slice(0, 600)
  return new ScraperError(message, provider, status, status === 0 || status === 429 || status >= 500)
}

async function safeJson(response: Response): Promise<any> {
  try { return await response.json() } catch { return {} }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  finally { clearTimeout(timer) }
}
