// HMAC authentication for the Lightsail lead worker. It deliberately uses a
// separate header contract from browser JWT auth and never exposes a database key.

const maxClockSkewMs = 5 * 60_000

export function leadSourceSecret(): string | null {
  // Existing deployments already have SCRAPER_SHARED_SECRET. A dedicated secret
  // can be added later without a flag day by setting LEAD_SOURCE_SHARED_SECRET.
  return Deno.env.get('LEAD_SOURCE_SHARED_SECRET') ?? Deno.env.get('SCRAPER_SHARED_SECRET')
}

export async function verifyLeadSourceRequest(req: Request, rawBody: string): Promise<boolean> {
  const secret = leadSourceSecret()
  if (!secret) return false
  const timestamp = req.headers.get('X-Botlio-Timestamp') ?? ''
  const signature = req.headers.get('X-Botlio-Signature') ?? ''
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || Math.abs(Date.now() - seconds * 1000) > maxClockSkewMs) return false
  const expected = await signLeadSource(`${timestamp}.${rawBody}`, secret)
  return timingSafeEqual(expected, signature)
}

export async function signLeadSource(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(expected: string, actual: string): boolean {
  if (!actual || expected.length !== actual.length) return false
  let diff = 0
  for (let index = 0; index < expected.length; index++) diff |= expected.charCodeAt(index) ^ actual.charCodeAt(index)
  return diff === 0
}
