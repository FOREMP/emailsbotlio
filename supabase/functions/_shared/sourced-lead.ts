import { classifyNiche } from './niche.ts'

export type MapsLead = Record<string, unknown>

export type PreparedSourcedLead = {
  placeId: string | null
  companyName: string
  normalizedName: string
  website: string | null
  email: string | null
  domain: string | null
  phone: string | null
  address: string | null
  category: string | null
  rating: number | null
  reviewsCount: number | null
  niche: string
  snapshot: Record<string, unknown>
}

export function prepareMapsLead(row: MapsLead): PreparedSourcedLead | null {
  const companyName = text(row.title ?? row.name)
  if (!companyName) return null
  const website = normalizeUrl(text(row.website ?? row.web_site))
  const email = firstEmail(Array.isArray(row.emails) ? row.emails.join(' ') : text(row.email ?? row.emails))
  const domain = extractDomain(website) ?? (email ? email.split('@')[1] : null)
  const category = text(row.category)
  const placeId = text(row.place_id ?? row.placeId) || null
  return {
    placeId,
    companyName,
    normalizedName: normalizeName(companyName),
    website,
    email,
    domain,
    phone: text(row.phone) || null,
    address: text(row.address) || null,
    category: category || null,
    rating: numberValue(row.review_rating ?? row.rating),
    reviewsCount: integerValue(row.review_count ?? row.reviews_count),
    niche: classifyNiche(category || null, companyName) ?? 'other',
    // Keep only operational source data; never retain full review/image blobs.
    snapshot: compactSnapshot(row),
  }
}

export function isContactableLead(lead: PreparedSourcedLead): boolean {
  return Boolean(lead.website && lead.email)
}

function compactSnapshot(row: MapsLead): Record<string, unknown> {
  const keys = ['place_id', 'cid', 'link', 'title', 'category', 'address', 'website', 'phone', 'review_count', 'review_rating', 'latitude', 'longitude']
  const output: Record<string, unknown> = {}
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) output[key] = row[key]
  return output
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim().slice(0, 800)
}
function firstEmail(value: string): string | null {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null
}
function normalizeUrl(value: string): string | null {
  if (!value) return null
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    url.hash = ''; url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch { return null }
}
function extractDomain(value: string | null): string | null {
  if (!value) return null
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase() } catch { return null }
}
function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]+/gu, '').trim()
}
function numberValue(value: unknown): number | null {
  const n = Number(String(value ?? '').replace(',', '.').match(/\d+(\.\d+)?/)?.[0])
  return Number.isFinite(n) ? n : null
}
function integerValue(value: unknown): number | null {
  const n = numberValue(value)
  return n === null ? null : Math.round(n)
}
