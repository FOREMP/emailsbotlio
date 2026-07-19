// Import Google-scraped company lists (CSV).
// Deepseek normalizes each batch of rows into a standard shape, then we
// dedupe-insert into site_leads. Rows without both a website AND an email
// go in as status='skipped_no_contact' so we never re-touch them.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = 'deepseek/deepseek-chat-v3.1'
const BATCH_SIZE = 20

// Columns we care about. Everything else (coordinates, plus_code, place_id,
// image URLs, hours, etc.) is dropped BEFORE we send anything to Deepseek so
// we don't waste tokens on data we're going to ignore anyway.
const KEEP_COLUMN_PATTERNS = [
  /name|title|company/i,
  /website|url|site|domain/i,
  /email|mail/i,
  /phone|tel|mobile/i,
  /address|street|city|postal|zip|region|country/i,
  /category|type|industry/i,
  /rating|score|stars/i,
  /review/i,
]
const DROP_COLUMN_PATTERNS = [
  /lat|lng|lon|coord|plus_code|place_id|cid|kml|fid|panorama/i,
  /hour|open|close|time|schedule/i,
  /image|photo|thumb|logo|icon|favicon/i,
  /^id$|_id$|uuid/i,
  /url_.*photo|profile_url|google_url|maps_url/i,
]

interface NormalizedLead {
  company_name?: string
  website?: string
  email?: string
  phone?: string
  address?: string
  category?: string
  rating?: number | null
  reviews_count?: number | null
  review_snippets?: string[]
}

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

    const { csv, source_file_id } = await req.json()
    if (typeof csv !== 'string' || !csv.trim()) return json({ error: 'csv required' }, 400)

    const rawRows = parseCsv(csv)
    if (rawRows.length < 2) return json({ error: 'need header + at least one row' }, 400)

    // Pre-filter columns so Deepseek only sees relevant fields.
    const header = rawRows[0]
    const keepIdx: number[] = []
    header.forEach((col, idx) => {
      const c = (col ?? '').trim()
      if (!c) return
      if (DROP_COLUMN_PATTERNS.some((r) => r.test(c))) return
      if (KEEP_COLUMN_PATTERNS.some((r) => r.test(c))) keepIdx.push(idx)
    })
    // Fallback: if no columns matched keep-patterns, keep everything not dropped.
    const finalKeepIdx = keepIdx.length > 0
      ? keepIdx
      : header.map((_, i) => i).filter((i) => !DROP_COLUMN_PATTERNS.some((r) => r.test(header[i] ?? '')))

    const slim = rawRows.map((r) => finalKeepIdx.map((i) => (r[i] ?? '').slice(0, 500)))
    const dataRows = slim.slice(1)

    const openrouter = Deno.env.get('OPENROUTER_API_KEY')
    if (!openrouter) return json({ error: 'OPENROUTER_API_KEY missing' }, 500)

    const normalized: NormalizedLead[] = []
    for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
      const chunk = [slim[0], ...dataRows.slice(i, i + BATCH_SIZE)]
      const csvChunk = chunk.map((r) => r.map(csvEscape).join(',')).join('\n')
      try {
        const batch = await normalizeBatch(csvChunk, openrouter)
        normalized.push(...batch)
      } catch (err) {
        console.error(`batch ${i} failed`, err)
        // Continue with next batch instead of aborting the whole import.
      }
    }


    // Dedupe-insert
    let inserted = 0, skipped_no_contact = 0, duplicates = 0, invalid = 0
    for (const n of normalized) {
      const name = (n.company_name ?? '').trim()
      if (!name) { invalid++; continue }
      const domain = extractDomain(n.website) || (n.email ? n.email.split('@')[1] : null)
      const hasWebsite = !!n.website
      const hasEmail = !!n.email && /.+@.+\..+/.test(n.email)
      const status = (hasWebsite && hasEmail) ? 'pending_audit'
        : (hasWebsite ? 'pending_audit' : 'skipped_no_contact')
      if (!hasWebsite && !hasEmail) skipped_no_contact++
      const { error } = await supabase.from('site_leads').insert({
        user_id: userId,
        company_name: name,
        company_name_normalized: normalizeName(name),
        domain,
        domain_normalized: domain ? domain.toLowerCase() : null,
        website: n.website ?? null,
        email: n.email ?? null,
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

async function normalizeBatch(csvChunk: string, apiKey: string): Promise<NormalizedLead[]> {
  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: [
          'You normalize Google-scraped business listing CSVs into a strict JSON shape.',
          'Return ONLY: {"leads":[{"company_name","website","email","phone","address","category","rating","reviews_count","review_snippets"}]}',
          'Rules:',
          '- Ignore coordinates, plus_code, place_id, cid, kml, hours, opening times, image URLs.',
          '- rating: number 0-5 or null. reviews_count: integer or null.',
          '- review_snippets: SELECT up to 3 of the BEST, most useful review texts. Prefer specific, substantive reviews (mentions service quality, staff, price, experience, concrete details) over generic ones ("Bra", "Ok", "👍", single emojis, one-word reviews, spam, non-language gibberish, duplicates). Prefer a mix of positive and constructive if available. Trim each snippet to <240 chars. Skip all if none are useful. Never invent text — only use what is present in the row.',
          '- If the row contains many review columns (review_1, review_2, ... or a single concatenated field), pick the best 1-3 per the rule above and discard the rest.',
          '- website: full https URL if any, else null. Strip tracking params.',
          '- email: first valid email if any, else null.',
          '- Preserve one row per input row in the same order. Empty fields become null.',
          '- No commentary. JSON only.',
        ].join('\n') },
        { role: 'user', content: csvChunk },
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
    return Array.isArray(parsed.leads) ? parsed.leads : []
  } catch {
    return []
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQ = false }
      } else field += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { cur.push(field); field = '' }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
      else if (c === '\r') { /* skip */ }
      else field += c
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur) }
  return rows.filter((r) => r.some((v) => v.trim().length > 0))
}

function csvEscape(s: string): string {
  if (s == null) return ''
  const needs = /[",\n\r]/.test(s)
  return needs ? `"${s.replace(/"/g, '""')}"` : s
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
