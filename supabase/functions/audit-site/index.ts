// On-demand audit entry point. It deliberately uses the exact same shared,
// screenshot-first evaluator as process-site-leads so manual and scheduled
// audits can never drift into different scoring systems again.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { auditWebsite, normaliseUrl } from '../_shared/site-audit.ts'
import { selectedScrapeProvider, ScraperError } from '../_shared/scraper-client.ts'

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
    if (!generated_site_id) return json({ error: 'generated_site_id required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: site, error: siteErr } = await supabase
      .from('generated_sites')
      .select('id, contact_id, source_url, language')
      .eq('id', generated_site_id)
      .single()
    if (siteErr || !site) return json({ error: 'site not found' }, 404)

    const { data: contact } = await supabase
      .from('contacts')
      .select('email, custom_fields')
      .eq('id', site.contact_id)
      .maybeSingle()
    const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>
    const contactLanguage = typeof cf.language === 'string' ? cf.language : null
    const companyName = String(cf.company_name ?? cf.company ?? cf.business_name ?? site.id)

    let targetUrl = url || site.source_url
    if (!targetUrl) {
      const websiteField = (cf.website ?? cf.url ?? cf.homepage ?? cf.hemsida ?? cf.webbsida ?? cf.webbplats ?? cf.site ?? cf.domain) as string | undefined
      if (websiteField) targetUrl = normaliseUrl(String(websiteField))
      else if (contact?.email) {
        const domain = String(contact.email).split('@')[1]
        if (domain && !isFreeEmail(domain)) targetUrl = `https://${domain}`
      }
    }

    await supabase.from('generated_sites').update({
      status: 'auditing',
      source_url: targetUrl,
      error_message: null,
    }).eq('id', generated_site_id)

    if (!targetUrl) {
      await supabase.from('generated_sites').update({
        status: 'audited',
        audit_score: 0,
        audit_reason: 'No existing website found — needs full generation.',
      }).eq('id', generated_site_id)
      return json({ score: 0, reason: 'no site' })
    }

    const language = site.language === 'en' || contactLanguage === 'en' ? 'en' : 'sv'
    const scrapeProvider = await selectedScrapeProvider(supabase)
    let result
    try {
      result = await auditWebsite(
        targetUrl,
        companyName,
        language,
        supabase,
        scrapeProvider,
      )
    } catch (error) {
      const typed = error instanceof ScraperError ? error : null
      const message = typed?.message ?? (error as Error).message
      await supabase.from('generated_sites').update({
        // Provider failures are retryable audit work, not evidence that the
        // lead's website is bad and not a reason to start generation.
        status: 'auditing',
        error_message: `${typed?.provider ?? 'audit'}: ${message}`.slice(0, 500),
      }).eq('id', generated_site_id)
      return json({ error: 'audit temporarily unavailable', provider: typed?.provider, details: message }, 503)
    }

    const { error: updateError } = await supabase.from('generated_sites').update({
      status: 'audited',
      audit_score: result.score,
      audit_reason: result.reason,
      source_url: targetUrl,
      error_message: null,
    }).eq('id', generated_site_id)
    if (updateError) throw new Error(`save audit: ${updateError.message}`)

    return json({
      score: result.score,
      reason: result.reason,
      confidence: result.confidence,
      uncertain: result.uncertain,
      second_opinion_used: result.secondOpinionUsed,
      first_score: result.firstScore,
      second_score: result.secondScore,
      url: targetUrl,
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

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com',
  'aol.com', 'me.com', 'protonmail.com', 'proton.me', 'yahoo.co.uk', 'yahoo.se',
  'hotmail.se', 'live.se', 'telia.com', 'spray.se', 'bredband.net',
])

function isFreeEmail(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase())
}
