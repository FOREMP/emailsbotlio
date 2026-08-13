alter table public.site_leads
  add column if not exists language text not null default 'sv';

alter table public.generated_sites
  add column if not exists language text not null default 'sv';

update public.site_leads
set language = 'sv'
where language is null or btrim(language) = '';

update public.generated_sites
set language = coalesce(
  nullif(gs.language, ''),
  nullif(sl.language, ''),
  'sv'
)
from public.generated_sites gs
left join public.site_leads sl on sl.id = gs.site_lead_id
where public.generated_sites.id = gs.id;

alter table public.site_leads
  drop constraint if exists site_leads_language_check;

alter table public.site_leads
  add constraint site_leads_language_check
  check (language in ('sv', 'en'));

alter table public.generated_sites
  drop constraint if exists generated_sites_language_check;

alter table public.generated_sites
  add constraint generated_sites_language_check
  check (language in ('sv', 'en'));

create index if not exists idx_site_leads_language on public.site_leads(language);
create index if not exists idx_generated_sites_language on public.generated_sites(language);

do $$
declare
  src_seq record;
  new_list_id uuid;
  new_seq_id uuid;
  node_rec record;
  edge_rec record;
  new_node_id uuid;
  new_config jsonb;
begin
  create temporary table if not exists tmp_sequence_node_clone_map (
    old_id uuid,
    new_id uuid
  ) on commit drop;

  for src_seq in
    select
      s.id as sequence_id,
      s.user_id,
      s.contact_list_id,
      s.status,
      s.sender_rotation,
      cl.name as list_name,
      cl.description as list_description
    from public.sequences s
    left join public.contact_lists cl on cl.id = s.contact_list_id
    where s.name = 'Site Demo Outreach'
  loop
    if exists (
      select 1
      from public.sequences s2
      where s2.user_id = src_seq.user_id
        and s2.name = 'Site Demo Outreach EN'
    ) then
      continue;
    end if;

    truncate table tmp_sequence_node_clone_map;

    insert into public.contact_lists (user_id, name, description)
    values (
      src_seq.user_id,
      'Site Demo Outreach EN',
      coalesce(src_seq.list_description, 'English site demo outreach leads')
    )
    returning id into new_list_id;

    insert into public.sequences (user_id, name, contact_list_id, status, sender_rotation, seeded)
    values (
      src_seq.user_id,
      'Site Demo Outreach EN',
      new_list_id,
      src_seq.status,
      src_seq.sender_rotation,
      true
    )
    returning id into new_seq_id;

    for node_rec in
      select *
      from public.sequence_nodes
      where sequence_id = src_seq.sequence_id
      order by position_y, created_at
    loop
      new_node_id := gen_random_uuid();
      new_config := coalesce(node_rec.config, '{}'::jsonb);
      new_config := replace(replace(new_config::text, 'foremp.email', 'foremp.eu'), 'gpt-4.1-mini', 'gpt-4o-mini')::jsonb;

      if node_rec.node_type = 'trigger' then
        new_config := jsonb_set(new_config, '{contact_list_id}', to_jsonb(new_list_id::text), true);
      end if;

      if node_rec.node_type = 'send_email' then
        new_config := jsonb_set(new_config, '{sender_domain}', to_jsonb('foremp.eu'::text), true);
        new_config := jsonb_set(new_config, '{model}', to_jsonb('gpt-4o-mini'::text), true);
      end if;

      insert into public.sequence_nodes (
        id,
        sequence_id,
        user_id,
        node_type,
        position_x,
        position_y,
        config
      )
      values (
        new_node_id,
        new_seq_id,
        src_seq.user_id,
        node_rec.node_type,
        node_rec.position_x,
        node_rec.position_y,
        new_config
      );

      insert into tmp_sequence_node_clone_map (old_id, new_id)
      values (node_rec.id, new_node_id);
    end loop;

    for edge_rec in
      select *
      from public.sequence_edges
      where sequence_id = src_seq.sequence_id
    loop
      insert into public.sequence_edges (
        sequence_id,
        user_id,
        source_node_id,
        target_node_id,
        source_handle
      )
      values (
        new_seq_id,
        src_seq.user_id,
        (select m.new_id from tmp_sequence_node_clone_map m where m.old_id = edge_rec.source_node_id limit 1),
        (select m.new_id from tmp_sequence_node_clone_map m where m.old_id = edge_rec.target_node_id limit 1),
        edge_rec.source_handle
      );
    end loop;
  end loop;
end
$$;
