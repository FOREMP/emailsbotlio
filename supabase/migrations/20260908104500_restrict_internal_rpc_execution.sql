-- Trigger and worker-only SECURITY DEFINER functions must not be callable
-- through the public REST RPC endpoint. The sender capacity functions are
-- used by the service-role sequence runner; the default-sender helper is the
-- only one intentionally available to signed-in users.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.normalize_enrollment_schedule_slot() from public, anon, authenticated;
revoke execute on function public.polish_generated_site_microcopy() from public, anon, authenticated;

revoke execute on function public.sender_capacity_remaining(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.sender_daily_remaining(uuid) from public, anon, authenticated;
revoke execute on function public.sender_warmup_quota(uuid) from public, anon, authenticated;
grant execute on function public.sender_capacity_remaining(uuid, boolean) to service_role;
grant execute on function public.sender_daily_remaining(uuid) to service_role;
grant execute on function public.sender_warmup_quota(uuid) to service_role;

revoke execute on function public.seed_default_senders() from public, anon;
grant execute on function public.seed_default_senders() to authenticated;
