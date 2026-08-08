// Audits an existing website: scrapes it with Firecrawl, then uses AI to score
// quality 1-10. High scores (>= skip_threshold) mean the lead has a decent
// site already — we can skip generation and save cost.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { auditWebsite } from '../_shared/site-audit.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


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
      const websiteField = (cf.website ?? cf.url ?? cf.homepage ?? cf.hemsida ?? cf.webbsida ?? cf.webbplats ?? cf.site ?? cf.domain) as string | undefined
      if (websiteField) targetUrl = normaliseUrl(String(websiteField))
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

    const fcKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!fcKey) return json({ error: 'FIRECRAWL_API_KEY not configured' }, 500)
    const lovableKey = Deno.env.get('LOVABLE_API_KEY')
    if (!lovableKey) return json({ error: 'LOVABLE_API_KEY missing' }, 500)

    // Same screenshot-first rubric as the outreach pipeline.
    const { data: contactRow } = await supabase
      .from('contacts')
      .select('first_name, last_name, custom_fields')
      .eq('id', site.contact_id)
      .maybeSingle()
    const cfName = (contactRow?.custom_fields ?? {}) as Record<string, unknown>
    const companyName = String(
      cfName.company_name ?? cfName.company ?? cfName.foretag ?? contactRow?.first_name ?? '',
    )

    let result
    try {
      result = await auditWebsite(targetUrl, companyName, fcKey, lovableKey)
    } catch (e) {
      await supabase.from('generated_sites').update({
        status: 'failed',
        error_message: `AI audit failed: ${(e as Error).message}`.slice(0, 400),
      }).eq('id', generated_site_id)
      return json({ error: 'ai audit failed', details: (e as Error).message }, 500)
    }

    await supabase.from('generated_sites').update({
      status: 'audited',
      audit_score: result.score,
      audit_reason: result.reason?.slice(0, 500) ?? null,
      source_url: result.url,
    }).eq('id', generated_site_id)

    return json({
      score: result.score,
      reason: result.reason,
      weaknesses: result.weaknesses,
      uncertain: result.uncertain,
      url: result.url,
    })

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
