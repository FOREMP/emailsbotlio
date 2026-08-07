-- Fix two production issues:
-- 1) Enrollments parked on a schedule node could keep a raw wait timestamp
--    such as Saturday/Sunday 09:20 even when the sequence schedule is Mon-Fri 09:00.
-- 2) Freeform generated sites could retain repeated deterministic renderer phrases.

create or replace function public._json_string_escape(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '"' from to_json(coalesce(value, ''))::text)
$$;

create or replace function public.next_sequence_schedule_slot(config jsonb, base_at timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  tod text := coalesce(nullif(config->>'time_of_day', ''), '09:00');
  hh int := greatest(0, least(23, coalesce(nullif(split_part(tod, ':', 1), '')::int, 9)));
  mi int := greatest(0, least(59, coalesce(nullif(split_part(tod, ':', 2), '')::int, 0)));
  allowed int[] := '{}';
  days_json jsonb := case when jsonb_typeof(config->'days') = 'array' then config->'days' else '[]'::jsonb end;
  local_base timestamp := base_at at time zone 'Europe/Stockholm';
  candidate_day timestamp;
  slot_local timestamp;
  dow int;
  i int;
begin
  select coalesce(array_agg(day_num), '{}')
    into allowed
  from (
    select case lower(value)
      when 'mon' then 1 when 'monday' then 1 when 'mån' then 1 when 'mandag' then 1
      when 'tue' then 2 when 'tuesday' then 2 when 'tis' then 2 when 'tisdag' then 2
      when 'wed' then 3 when 'wednesday' then 3 when 'ons' then 3 when 'onsdag' then 3
      when 'thu' then 4 when 'thursday' then 4 when 'tor' then 4 when 'torsdag' then 4
      when 'fri' then 5 when 'friday' then 5 when 'fre' then 5 when 'fredag' then 5
      when 'sat' then 6 when 'saturday' then 6 when 'lör' then 6 when 'lordag' then 6 when 'lördag' then 6
      when 'sun' then 7 when 'sunday' then 7 when 'sön' then 7 when 'sondag' then 7 when 'söndag' then 7
      else null
    end as day_num
    from jsonb_array_elements_text(days_json)
  ) d
  where day_num is not null;

  for i in 0..8 loop
    candidate_day := date_trunc('day', local_base) + make_interval(days => i);
    dow := extract(isodow from candidate_day)::int;

    if cardinality(allowed) = 0 or dow = any(allowed) then
      slot_local := candidate_day + make_interval(hours => hh, mins => mi);

      -- If the wait finishes within the 30 minute send window, keep this slot.
      -- Otherwise move to the next allowed day/time.
      if slot_local >= local_base or (i = 0 and local_base <= slot_local + interval '30 minutes') then
        return slot_local at time zone 'Europe/Stockholm';
      end if;
    end if;
  end loop;

  -- Defensive fallback: should only happen with impossible schedule config.
  return (date_trunc('day', local_base) + interval '1 day' + make_interval(hours => hh, mins => mi)) at time zone 'Europe/Stockholm';
end;
$$;

create or replace function public.normalize_enrollment_schedule_slot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  node_type text;
  node_config jsonb;
begin
  if new.current_node_id is null
     or new.next_send_at is null
     or new.status not in ('active', 'waiting_capacity') then
    return new;
  end if;

  select n.node_type, n.config
    into node_type, node_config
  from public.sequence_nodes n
  where n.id = new.current_node_id;

  if node_type = 'schedule' then
    new.next_send_at := public.next_sequence_schedule_slot(coalesce(node_config, '{}'::jsonb), new.next_send_at);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_enrollment_schedule_slot on public.enrollments;
create trigger trg_normalize_enrollment_schedule_slot
before insert or update of current_node_id, next_send_at, status
on public.enrollments
for each row
execute function public.normalize_enrollment_schedule_slot();

create or replace function public.polish_generated_site_microcopy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lead_company text;
  lead_category text;
  company text;
  category text;
  is_clinic boolean;
  is_beauty boolean;
  contact_title text;
  contact_lead text;
  faq_title text;
  gallery_lead text;
  footer_text text;
  body text;
begin
  if new.generated_files is null then
    return new;
  end if;

  select sl.company_name, sl.category
    into lead_company, lead_category
  from public.site_leads sl
  where sl.id = new.site_lead_id;

  company := coalesce(nullif(trim(lead_company), ''), 'företaget');
  category := lower(coalesce(lead_category, ''));
  is_clinic := category ~ '(klinik|clinic|massage|hud|skin|terapi|vård|vard|injektion|laser|behandling)';
  is_beauty := is_clinic or category ~ '(frisör|frisor|hair|salong|beauty|skön|skon|nagel|nail|bryn|frans|makeup)';

  contact_title := case
    when is_clinic then 'Boka eller fråga ' || company || '.'
    when is_beauty then 'Hitta rätt tid hos ' || company || '.'
    else 'Ta nästa steg med ' || company || '.'
  end;

  contact_lead := case
    when is_clinic then 'Ring eller mejla för frågor om behandlingar, bokning eller vilken väg som passar bäst.'
    when is_beauty then 'Ring eller mejla så blir det enkelt att hitta rätt behandling, tid eller nästa steg.'
    else 'Ring eller mejla så får du snabbt rätt kontaktväg och tydlig information.'
  end;

  faq_title := case
    when is_clinic then 'Vanliga frågor inför bokning.'
    when is_beauty then 'Bra att veta innan du bokar.'
    else 'Bra att veta innan du tar kontakt.'
  end;

  gallery_lead := case
    when is_clinic then 'En lugn visuell känsla, tydlig struktur och bra kontrast gör det lättare att förstå utbudet och känna förtroende innan bokning.'
    when is_beauty then 'Stora bildytor, mjuk rytm och tydlig kontrast ger en mer exklusiv känsla och låter behandlingarna ta plats.'
    else 'Tydlig struktur, starka bildytor och bra kontrast ger ett mer genomarbetat första intryck och gör erbjudandet lättare att förstå.'
  end;

  footer_text := case
    when is_clinic then 'Tydlig information om behandlingar, trygg känsla och enkel kontakt inför bokning.'
    when is_beauty then 'Tydliga behandlingar, varm känsla och enkel kontakt inför bokning.'
    else 'Tydlig information, professionell känsla och enkel kontakt inför nästa steg.'
  end;

  body := new.generated_files::text;
  body := replace(body, 'Enkel kontakt, utan formulär.', public._json_string_escape(contact_title));
  body := replace(body, 'Besökaren får tydliga vägar vidare direkt, särskilt viktigt på mobil.', public._json_string_escape(contact_lead));
  body := replace(body, 'Snabba svar innan kontakt.', public._json_string_escape(faq_title));
  body := replace(body, 'Stora bildytor, tydlig rytm och bra kontrast ger ett mer exklusivt första intryck och gör innehållet lättare att ta in.', public._json_string_escape(gallery_lead));
  body := replace(body, 'Tydlig information, varm känsla och enkel kontakt inför nästa steg.', public._json_string_escape(footer_text));

  new.generated_files := body::jsonb;
  return new;
exception when others then
  raise warning 'polish_generated_site_microcopy skipped for generated_site %, reason: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_polish_generated_site_microcopy on public.generated_sites;
create trigger trg_polish_generated_site_microcopy
before insert or update of generated_files, site_lead_id
on public.generated_sites
for each row
execute function public.polish_generated_site_microcopy();

-- Normalize currently parked schedule-node enrollments once so the dashboard
-- no longer shows weekend/09:20 slots for Mon-Fri 09:00 sequences.
update public.enrollments e
set next_send_at = public.next_sequence_schedule_slot(n.config, e.next_send_at)
from public.sequence_nodes n
where n.id = e.current_node_id
  and n.node_type = 'schedule'
  and e.status in ('active', 'waiting_capacity')
  and e.next_send_at is not null;

-- Re-run the site microcopy cleanup for already stored generated files.
-- This does not redeploy old Vercel demos, but it fixes stored files and all
-- future pipeline writes before deployment.
update public.generated_sites
set generated_files = generated_files
where generated_files is not null
  and generated_files::text like '%Enkel kontakt, utan formulär.%';
