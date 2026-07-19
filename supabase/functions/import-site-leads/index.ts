// Import one small batch of Google-scraped company rows.
// The browser parses the file and sends only ~20 mapped rows per call. This
// keeps the Edge Function under Supabase worker limits and uses AI only for
// picking the best review snippets, not for re-reading every column.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'deepseek/deepseek-chat-v3.1'
const MAX_ROWS_PER_CALL = 25
const MAX_REVIEW_ROWS_PER_AI_CALL = 20
const MAX_REVIEW_CANDIDATES_PER_ROW = 10
const MAX_REVIEW_CHARS = 260

interface NormalizedLead {
  company_name?: string | null
  website?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  category?: string | null
  rating?: number | null
  reviews_count?: number | null
  review_snippets?: string[]
}

type ImportRole =
  | 'skip'
  | 'company_name'
  | 'website'
  | 'email'
  | 'phone'
  | 'address'
  | 'category'
  | 'rating'
  | 'reviews_count'
  | 'review'

type ImportRow = Record<string, string | number | null | undefined>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'missing auth' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: userRes } = await supabase.auth.getUser(jwt)
    const userId = userRes?.user?.id
    if (!userId) return json({ error: 'invalid auth' }, 401)

    const body = await req.json()
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS_PER_CALL) as ImportRow[] : []
    const mapping = isPlainObject(body.mapping) ? body.mapping as Record<string, ImportRole> : {}
    const source_file_id = typeof body.source_file_id === 'string' ? body.source_file_id : null

    if (rows.length === 0) return json({ error: 'rows required' }, 400)
    if (Object.keys(mapping).length === 0) return json({ error: 'mapping required' }, 400)

    const normalized = rows.map((row) => normalizeMappedRow(row, mapping))
    const reviewInput = rows
      .map((row, index) => ({ index, reviews: collectReviewCandidates(row, mapping) }))
      .filter((r) => r.reviews.length > 0)
      .slice(0, MAX_REVIEW_ROWS_PER_AI_CALL)

    if (reviewInput.length > 0) {
      const openrouter = Deno.env.get('OPENROUTER_API_KEY')
      if (!openrouter) return json({ error: 'OPENROUTER_API_KEY missing' }, 500)
      try {
        const picked = await pickReviewSnippets(reviewInput, openrouter)
        for (const [idx, snippets] of Object.entries(picked)) {
          const n = Number(idx)
          if (Number.isInteger(n) && normalized[n] && Array.isArray(snippets)) {
            normalized[n].review_snippets = snippets
              .map((s) => cleanCell(s).slice(0, 220))
              .filter(usefulReviewCandidate)
              .slice(0, 3)
          }
        }
      } catch (err) {
        console.error('review picker failed', err)
        // Import still succeeds; reviews are optional enrichment.
      }
    }


    // Dedupe-insert
    let inserted = 0, skipped_no_contact = 0, duplicates = 0, invalid = 0
    for (const n of normalized) {
      const name = (n.company_name ?? '').trim()
      if (!name) { invalid++; continue }
      const domain = extractDomain(n.website) || (n.email ? n.email.split('@')[1] : null)
      const website = normalizeUrl(n.website)
      const email = normalizeEmail(n.email)
      const finalDomain = extractDomain(website) || (email ? email.split('@')[1] : domain)
      const hasWebsite = !!website
      const hasEmail = !!email
      const status = (hasWebsite && hasEmail) ? 'pending_audit' : 'skipped_no_contact'
      if (status === 'skipped_no_contact') skipped_no_contact++
      const { error } = await supabase.from('site_leads').insert({
        user_id: userId,
        company_name: name,
        company_name_normalized: normalizeName(name),
        domain: finalDomain,
        domain_normalized: finalDomain ? finalDomain.toLowerCase() : null,
        website,
        email,
        phone: n.phone ?? null,
        address: n.address ?? null,
        category: n.category ?? null,
        rating: n.rating ?? null,
        reviews_count: n.reviews_count ?? null,
        review_snippets: n.review_snippets ?? null,
        status,
        source_file_id: source_file_id ?? null,
      })
      if (error) {
        if (error.code === '23505') duplicates++
        else console.error('insert err', error)
      } else {
        inserted++
      }
    }

    return json({ ok: true, total: normalized.length, inserted, duplicates, invalid, skipped_no_contact })
  } catch (err) {
    console.error('import-site-leads', err)
    return json({ error: (err as Error).message }, 500)
  }
})

function normalizeMappedRow(row: ImportRow, mapping: Record<string, ImportRole>): NormalizedLead {
  const read = (role: ImportRole): string | null => {
    for (const [header, mappedRole] of Object.entries(mapping)) {
      if (mappedRole !== role) continue
      const value = cleanCell(row[header])
      if (value) return value
    }
    return null
  }

  const company_name = read('company_name') || readFallback(row, [/^name$/i, /company|business|title/i])
  const website = read('website') || readFallback(row, [/website|web site|site|domain|homepage|url/i])
  const email = read('email') || firstEmail(Object.values(row).map(cleanCell).join(' '))
  const phone = read('phone') || readFallback(row, [/phone|tel|mobile/i])
  const address = read('address') || readFallback(row, [/address|street|city|postal|zip|region|country/i])
  const category = read('category') || readFallback(row, [/category|type|industry/i])
  const rating = toNumber(read('rating') || readFallback(row, [/rating|stars|score/i]))
  const reviews_count = toInteger(read('reviews_count') || readFallback(row, [/reviews?_count|review.*number|number.*review/i]))

  return { company_name, website, email, phone, address, category, rating, reviews_count, review_snippets: [] }
}

async function pickReviewSnippets(
  items: { index: number; reviews: string[] }[],
  apiKey: string,
): Promise<Record<string, string[]>> {
  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: [
          'Pick useful customer review snippets from already-extracted review candidates.',
          'Return ONLY JSON: {"reviews":{"0":["snippet"],"1":[]}} where keys are input indexes.',
          'For each business, select 0-3 reviews. Prefer specific details about service, staff, price, quality, waiting time, trust, or problems.',
          'Skip generic/empty/emoji-only/spam/duplicate one-word reviews. Never invent or rewrite. Trim each snippet to max 220 chars.',
        ].join('\n') },
        { role: 'user', content: JSON.stringify({ businesses: items }) },
      ],
    }),
  })
  if (!resp.ok) {
    const t = await resp.text()
    throw new Error(`deepseek ${resp.status}: ${t.slice(0, 300)}`)
  }
  const j = await resp.json()
  const content = j.choices?.[0]?.message?.content ?? '{}'
  try {
    const parsed = JSON.parse(content)
    return isPlainObject(parsed.reviews) ? parsed.reviews : {}
  } catch {
    return {}
  }
}

function collectReviewCandidates(row: ImportRow, mapping: Record<string, ImportRole>): string[] {
  const out: string[] = []
  for (const [header, role] of Object.entries(mapping)) {
    if (role !== 'review') continue
    out.push(...splitReviews(cleanCell(row[header])))
  }
  return Array.from(new Set(out))
    .filter((s) => usefulReviewCandidate(s))
    .slice(0, MAX_REVIEW_CANDIDATES_PER_ROW)
}

function splitReviews(value: string): string[] {
  return value
    .split(/\n+|\s+\|\|\s+|\s+••\s+|\s+---\s+/g)
    .map((s) => s.trim().replace(/\s+/g, ' ').slice(0, MAX_REVIEW_CHARS))
    .filter(Boolean)
}

function usefulReviewCandidate(value: string): boolean {
  const letters = value.replace(/[^\p{L}]/gu, '')
  return value.length >= 18 && letters.length >= 10 && !/^\d+(\.\d+)?$/.test(value)
}

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim().slice(0, 800)
}

function readFallback(row: ImportRow, patterns: RegExp[]): string | null {
  for (const [key, value] of Object.entries(row)) {
    if (patterns.some((r) => r.test(key))) {
      const clean = cleanCell(value)
      if (clean) return clean
    }
  }
  return null
}

function firstEmail(text: string): string | null {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null
}

function normalizeEmail(value?: string | null): string | null {
  return firstEmail(value ?? '')
}

function normalizeUrl(value?: string | null): string | null {
  if (!value) return null
  const first = value.split(/[\s,]+/).find((v) => /[\w-]+\.[a-z]{2,}/i.test(v)) ?? value
  try {
    const u = new URL(/^https?:\/\//i.test(first) ? first : `https://${first}`)
    u.hash = ''
    u.search = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function toNumber(value?: string | null): number | null {
  if (!value) return null
  const n = Number(value.replace(',', '.').match(/\d+(\.\d+)?/)?.[0])
  return Number.isFinite(n) ? n : null
}

function toInteger(value?: string | null): number | null {
  const n = toNumber(value)
  return n === null ? null : Math.round(n)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]+/gu, '').trim()
}

function extractDomain(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch { return null }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
