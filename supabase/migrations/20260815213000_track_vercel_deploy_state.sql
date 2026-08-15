alter table public.generated_sites
  add column if not exists vercel_deployment_id text,
  add column if not exists vercel_ready_state text,
  add column if not exists vercel_alias_candidates jsonb not null default '[]'::jsonb,
  add column if not exists last_deploy_check_at timestamptz,
  add column if not exists deploy_check_count integer not null default 0;

update public.generated_sites
set vercel_alias_candidates = '[]'::jsonb
where vercel_alias_candidates is null;
