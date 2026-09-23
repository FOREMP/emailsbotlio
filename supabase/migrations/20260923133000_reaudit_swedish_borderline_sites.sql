-- Apply only AFTER the new process-site-leads function is deployed. This
-- requeues untouched Swedish 5–6 audits for the two-page evidence audit. It
-- preserves the previous audit JSON under re-audit metadata for traceability.

update public.site_leads
set
  status = 'pending_audit',
  auto_send = false,
  triaged_at = null,
  feedback = 'Queued for a smarter two-page website re-audit.',
  audit_details = coalesce(audit_details, '{}'::jsonb) || jsonb_build_object(
    'reaudit_requested_at', now(),
    'reaudit_reason', 'Swedish borderline 5–6 audit refreshed with a second relevant page.',
    'previous_audit_score', audit_score,
    'previous_audit_reason', audit_reason
  )
where language = 'sv'
  and status in ('awaiting_audit_approval', 'needs_triage')
  and audit_score between 5 and 6
  and coalesce(audit_details ->> 'operator_decision_source', '') <> 'operator';
