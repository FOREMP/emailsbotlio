alter table public.senders
  add column if not exists language text not null default 'sv';

update public.senders
set language = case
  when lower(coalesce(from_email, '')) like '%@foremp.eu' then 'en'
  else 'sv'
end;

create index if not exists senders_user_language_active_idx
  on public.senders (user_id, language, is_active);
