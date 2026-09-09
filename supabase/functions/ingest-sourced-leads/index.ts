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

    const prepared = rows.map((row) => {
      const lead = prepareMapsLead(row)
      return {
        contactable: Boolean(lead && isContactableLead(lead)),
        place_id: lead?.placeId ?? null,
        company_name: lead?.companyName ?? String(row.title ?? row.name ?? '').slice(0, 800),
        normalized_name: lead?.normalizedName ?? '',
        website: lead?.website ?? null,
        email: lead?.email ?? null,
        domain: lead?.domain ?? null,
        phone: lead?.phone ?? null,
        address: lead?.address ?? null,
        category: lead?.category ?? null,
        rating: lead?.rating ?? null,
        reviews_count: lead?.reviewsCount ?? null,
        niche: lead?.niche ?? 'other',
        snapshot: lead?.snapshot ?? {},
      }
    })
    const { data: batchRows, error: batchError } = await supabase.rpc('ingest_sourced_leads_batch', {
      _job_id: jobId,
      _user_id: job.user_id,
      _language: job.language,
      _rows: prepared,
    })
    if (batchError) throw new Error(`batch import failed: ${batchError.message}`)
    const totals = batchRows?.[0] ?? { imported: 0, duplicates: 0, rejected: 0, failed: 0 }
    await supabase.from('lead_scrape_jobs').update({ state: 'importing' }).eq('id', jobId)
    return json({
      ok: true,
      imported: Number(totals.imported ?? 0),
      duplicates: Number(totals.duplicates ?? 0),
      rejected: Number(totals.rejected ?? 0),
      failed: Number(totals.failed ?? 0),
    })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}
