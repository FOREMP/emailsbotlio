// Audits an existing website: scrapes it with Firecrawl, then uses AI to score
// quality 1-10. High scores (>= skip_threshold) mean the lead has a decent
// site already — we can skip generation and save cost.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2'
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1'

interface AuditRequest {
  generated_site_id: string
  url?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { generated_site_id, url }: AuditRequest = await req.json()
    if (!generated_site_id) {
      return json({ error: 'generated_site_id required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Load the row + optional URL fallback from contacts
    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, contact_id, source_url')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)

    let targetUrl = url || site.source_url
    if (!targetUrl) {
      // Try to derive from contact.website / email domain
      const { data: contact } = await supabase
        .from('contacts')
        .select('email, custom_fields')
        .eq('id', site.contact_id)
        .single()
      const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>
      const websiteField = (cf.website ?? cf.url ?? cf.homepage) as string | undefined
      if (websiteField) targetUrl = normaliseUrl(websiteField)
      else if (contact?.email) {
        const domain = String(contact.email).split('@')[1]
        if (domain && !isFreeEmail(domain)) targetUrl = `https://${domain}`
      }
    }

    await supabase.from('generated_sites').update({ status: 'auditing', source_url: targetUrl }).eq('id', generated_site_id)

    if (!targetUrl) {
      // No site to audit — score = 0, needs full generation
      await supabase.from('generated_sites').update({
        status: 'audited',
        audit_score: 0,
        audit_reason: 'No existing website found — needs full generation.',
      }).eq('id', generated_site_id)
      return json({ score: 0, reason: 'no site' })
    }

    // Scrape with Firecrawl (markdown only — cheap)
    const fcKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!fcKey) return json({ error: 'FIRECRAWL_API_KEY not configured' }, 500)

    const fcResp = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: targetUrl,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    })
    const fcData = await fcResp.json()
    if (!fcResp.ok) {
      await supabase.from('generated_sites').update({
        status: 'audited',
        audit_score: 0,
        audit_reason: `Could not reach site (${fcResp.status}). Treating as needs generation.`,
      }).eq('id', generated_site_id)
      return json({ score: 0, reason: 'unreachable', details: fcData })
    }

    const markdown: string = fcData.data?.markdown ?? fcData.markdown ?? ''
    const title: string = fcData.data?.metadata?.title ?? fcData.metadata?.title ?? ''

    // Score with AI
    const lovableKey = Deno.env.get('LOVABLE_API_KEY')
    if (!lovableKey) return json({ error: 'LOVABLE_API_KEY missing' }, 500)

    const aiResp = await fetch(`${AI_GATEWAY}/chat/completions`, {
      method: 'POST',
      headers: { 'Lovable-API-Key': lovableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          {
            role: 'system',
            content:
              'You audit small-business websites. Rate the site 1-10 on how modern, trustworthy, and conversion-ready it looks based on the provided title and content. 1-3 = outdated/broken, 4-6 = basic but usable, 7-10 = already good. Reply with strict JSON: {"score": number, "reason": string (max 200 chars)}.',
          },
          {
            role: 'user',
            content: `URL: ${targetUrl}\nTitle: ${title}\n\nContent excerpt:\n${markdown.slice(0, 3000)}`,
          },
        ],
        response_format: { type: 'json_object' },
      }),
    })
    const aiData = await aiResp.json()
    if (!aiResp.ok) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `AI audit failed: ${JSON.stringify(aiData).slice(0, 400)}`,
      }).eq('id', generated_site_id)
      return json({ error: 'ai audit failed', details: aiData }, aiResp.status)
    }

    let parsed: { score: number; reason: string } = { score: 5, reason: 'unparsed' }
    try {
      parsed = JSON.parse(aiData.choices?.[0]?.message?.content ?? '{}')
    } catch (_) { /* keep default */ }

    await supabase.from('generated_sites').update({
      status: 'audited',
      audit_score: Math.max(0, Math.min(10, Math.round(parsed.score))),
      audit_reason: parsed.reason?.slice(0, 500) ?? null,
      source_url: targetUrl,
    }).eq('id', generated_site_id)

    return json({ score: parsed.score, reason: parsed.reason, url: targetUrl })
  } catch (err) {
    console.error('audit-site error', err)
    return json({ error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normaliseUrl(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `https://${s.replace(/^\/+/, '')}`
}

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com',
  'aol.com', 'me.com', 'protonmail.com', 'proton.me', 'yahoo.co.uk', 'yahoo.se',
  'hotmail.se', 'live.se', 'telia.com', 'spray.se', 'bredband.net',
])
function isFreeEmail(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase())
}
