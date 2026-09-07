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
  return (data?.value as any)?.provider === 'botlio_scraper' ? 'botlio_scraper' : 'firecrawl'
}

export async function scrapeUrl(
  provider: ScrapeProvider,
  url: string,
  options: { screenshot?: boolean } = {},
): Promise<ScraperPayload> {
  return provider === 'botlio_scraper'
    ? scrapeWithBotlioWorker(url, options)
    : scrapeWithFirecrawl(url, options)
}

export async function mapUrl(provider: ScrapeProvider, url: string): Promise<string[]> {
  if (provider === 'botlio_scraper') {
    const data = await scrapeWithBotlioWorker(url, { screenshot: false })
    return Array.isArray(data.links) ? data.links.filter((value): value is string => typeof value === 'string') : []
  }

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
  const secret = Deno.env.get('SCRAPER_WORKER_SECRET')
  if (!baseUrl || !secret) throw new ScraperError('SCRAPER_WORKER_URL or SCRAPER_WORKER_SECRET missing', 'botlio_scraper', 503, false)
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
