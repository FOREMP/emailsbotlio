import { createClient } from 'npm:@supabase/supabase-js@2'
import { verifyLeadSourceRequest } from '../_shared/lead-source-auth.ts'
import { isContactableLead, prepareMapsLead, type MapsLead } from '../_shared/sourced-lead.ts'

const MAX_ROWS = 25

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const raw = await req.text()
  if (!(await verifyLeadSourceRequest(req, raw))) return json({ error: 'invalid worker signature' }, 401)
  try {
    const body = JSON.parse(raw)
    const jobId = typeof body.job_id === 'string' ? body.job_id : ''
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) as MapsLead[] : []
    if (!jobId || rows.length === 0) return json({ error: 'job_id and rows are required' }, 400)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: job, error: jobError } = await supabase
      .from('lead_scrape_jobs')
      .select('id, user_id, market_id, language, state')
      .eq('id', jobId)
      .maybeSingle()
    if (jobError || !job) return json({ error: 'lead sourcing job not found' }, 404)
    if (['completed', 'failed', 'cancelled'].includes(job.state)) return json({ error: 'job is closed' }, 409)

    let imported = 0, duplicates = 0, rejected = 0, failed = 0
    for (const row of rows) {
      const lead = prepareMapsLead(row)
      if (!lead || !isContactableLead(lead)) {
        rejected++
        await recordResult(supabase, jobId, lead, 'rejected', 'missing a usable website or email')
        continue
      }
      const { data: inserted, error } = await supabase.from('site_leads').insert({
        user_id: job.user_id,
        company_name: lead.companyName,
        company_name_normalized: lead.normalizedName,
        domain: lead.domain,
        domain_normalized: lead.domain,
        website: lead.website,
        email: lead.email,
        phone: lead.phone,
        address: lead.address,
        category: lead.category,
        rating: lead.rating,
        reviews_count: lead.reviewsCount,
        language: job.language,
        niche: lead.niche,
        status: 'pending_audit',
        source_provider: 'google_maps',
        source_place_id: lead.placeId,
        source_job_id: jobId,
        source_market_id: job.market_id,
      }).select('id').single()
      if (error) {
        if (error.code === '23505') {
          duplicates++
          await recordResult(supabase, jobId, lead, 'duplicate', 'already imported')
        } else {
          failed++
          await recordResult(supabase, jobId, lead, 'failed', error.message.slice(0, 400))
        }
        continue
      }
      imported++
      await recordResult(supabase, jobId, lead, 'imported', null, inserted?.id ?? null)
    }
    await supabase.from('lead_scrape_jobs').update({ state: 'importing' }).eq('id', jobId)
    return json({ ok: true, imported, duplicates, rejected, failed })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

async function recordResult(supabase: any, jobId: string, lead: ReturnType<typeof prepareMapsLead>, outcome: string, reason: string | null, siteLeadId: string | null = null) {
  if (!lead) return
  const { error } = await supabase.from('lead_scrape_results').insert({
    job_id: jobId, place_id: lead.placeId, company_name: lead.companyName, website: lead.website,
    email: lead.email, outcome, rejection_reason: reason, site_lead_id: siteLeadId, source_snapshot: lead.snapshot,
  })
  // A retried chunk can legitimately attempt to write the same Google place.
  // Its first outcome is already retained; the site_leads unique indexes still
  // protect the actual lead record.
  if (error && error.code !== '23505') console.error('lead scrape result write failed', error)
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
