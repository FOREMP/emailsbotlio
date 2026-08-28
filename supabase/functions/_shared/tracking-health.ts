export const TRACKING_HEALTH_MAX_AGE_MS = 36 * 60 * 60 * 1000
export const TRACKING_RECHECK_MIN_AGE_MS = 10 * 60 * 1000

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function trackingHostForDomain(domain: string): string | null {
  const normalized = String(domain ?? '').trim().toLowerCase()
  if (!DOMAIN_RE.test(normalized)) return null
  return `https://t.${normalized}`
}

export function isFreshTrackingHost(row: any, now = Date.now()): boolean {
  const host = String(row?.tracking_host ?? '').trim()
  const checked = Date.parse(String(row?.tracking_host_verified_at ?? ''))
  return !!host && Number.isFinite(checked) && checked >= now - TRACKING_HEALTH_MAX_AGE_MS
}

export async function checkTrackingHost(baseUrl: string, timeoutMs = 8_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const url = `${baseUrl.replace(/\/+$/, '')}/health.gif?probe=${crypto.randomUUID()}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'image/gif',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Botlio-Tracking-Health/1.0',
      },
    })
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const endpoint = response.headers.get('x-botlio-tracking-endpoint') ?? ''
    const healthy = response.status === 200
      && contentType.startsWith('image/gif')
      && endpoint === 'track-open'

    return {
      healthy,
      status: response.status,
      contentType,
      error: healthy
        ? null
        : `Expected 200 image/gif from track-open, received ${response.status} ${contentType || 'without content-type'}`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      healthy: false,
      status: null,
      contentType: '',
      error: error instanceof DOMException && error.name === 'AbortError'
        ? `Timed out after ${timeoutMs}ms`
        : message,
    }
  } finally {
    clearTimeout(timer)
  }
}

