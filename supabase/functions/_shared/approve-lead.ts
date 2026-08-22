// Server-side equivalent of the manual "Godkänn" action in SiteApprovals.tsx.
// Used by the auto-send path: when a demo goes live for a lead the user already
// triaged as "build + send directly", we enroll it without a second review.

export function isCanonicalDemoUrl(value?: string | null): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.vercel.app') && !url.hostname.endsWith('-foremp.vercel.app')
  } catch {
    return false
  }
}

export interface ApprovableLead {
  id: string
  user_id: string
  company_name: string
  language: string | null
  email: string | null
  phone: string | null
  website: string | null
  category: string | null
  audit_score: number | null
  audit_reason: string | null
  audit_details: { weaknesses?: string[] } | null
  demo_url: string | null
  generated_site_id: string | null
}

/**
 * Creates/updates the ghost contact and ensures exactly one active enrollment
 * on the language-matched Site Demo Outreach sequence.
 * Throws on any problem — the caller decides whether to fall back to manual review.
 */
export async function approveLeadForOutreach(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  lead: ApprovableLead,
): Promise<{ contact_id: string; demo_url: string }> {
  if (!lead.email) throw new Error('lead has no email')

  const sequenceName = lead.language === 'en' ? 'Site Demo Outreach EN' : 'Site Demo Outreach'
  const { data: seq, error: seqErr } = await supabase
    .from('sequences')
    .select('id, contact_list_id')
    .eq('user_id', lead.user_id)
    .eq('name', sequenceName)
    .maybeSingle()
  if (seqErr) throw seqErr
  if (!seq?.id || !seq.contact_list_id) throw new Error(`${sequenceName} sequence missing`)

  const { data: triggerNode } = await supabase
    .from('sequence_nodes')
    .select('id')
    .eq('sequence_id', seq.id)
    .eq('node_type', 'trigger')
    .maybeSingle()
  if (!triggerNode?.id) throw new Error(`${sequenceName} has no trigger node`)

  let canonicalDemoUrl = lead.demo_url
  if (lead.generated_site_id) {
    const { data: gs } = await supabase
      .from('generated_sites')
      .select('demo_site_url')
      .eq('id', lead.generated_site_id)
      .maybeSingle()
    canonicalDemoUrl = gs?.demo_site_url ?? canonicalDemoUrl
  }
  if (!isCanonicalDemoUrl(canonicalDemoUrl)) throw new Error('demo has no stable public URL yet')

  const emailLower = lead.email.toLowerCase().trim()
  const weakness = lead.audit_details?.weaknesses?.[0] ?? lead.audit_reason ?? ''
  const firstName = emailLower.split('@')[0].split(/[._-]/)[0].replace(/^\w/, (c) => c.toUpperCase())
  const custom_fields = {
    site_lead_id: lead.id,
    company_name: lead.company_name,
    demo_url: canonicalDemoUrl,
    website: lead.website ?? '',
    audit_weakness: weakness,
    audit_score: lead.audit_score ?? '',
    category: lead.category ?? '',
    language: lead.language ?? 'sv',
  }

  const { data: existing } = await supabase
    .from('contacts')
    .select('id, custom_fields')
    .eq('user_id', lead.user_id)
    .eq('list_id', seq.contact_list_id)
    .eq('email', emailLower)
    .maybeSingle()

  let contactId: string
  if (existing?.id) {
    const merged = { ...(existing.custom_fields ?? {}), ...custom_fields }
    await supabase
      .from('contacts')
      .update({ custom_fields: merged, first_name: firstName, demo_site_url: canonicalDemoUrl })
      .eq('id', existing.id)
    contactId = existing.id
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('contacts')
      .insert({
        user_id: lead.user_id,
        list_id: seq.contact_list_id,
        email: emailLower,
        first_name: firstName,
        phone: lead.phone,
        demo_site_url: canonicalDemoUrl,
        custom_fields,
        tags: ['site-demo'],
      })
      .select('id')
      .single()
    if (insErr) throw insErr
    contactId = inserted.id
  }

  const { data: existingEnr } = await supabase
    .from('enrollments')
    .select('id')
    .eq('user_id', lead.user_id)
    .eq('sequence_id', seq.id)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existingEnr?.id) {
    await supabase.from('enrollments').update({
      status: 'active',
      current_node_id: triggerNode.id,
      current_step: 0,
      next_send_at: new Date().toISOString(),
      last_error: null,
      error_at: null,
    }).eq('id', existingEnr.id)
  } else {
    const { error: enrErr } = await supabase.from('enrollments').insert({
      user_id: lead.user_id,
      sequence_id: seq.id,
      contact_id: contactId,
      status: 'active',
      current_node_id: triggerNode.id,
      current_step: 0,
      next_send_at: new Date().toISOString(),
    })
    if (enrErr) throw enrErr
  }

  return { contact_id: contactId, demo_url: canonicalDemoUrl! }
}
