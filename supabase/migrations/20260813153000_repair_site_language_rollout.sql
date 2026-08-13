alter table public.site_leads
  add column if not exists language text not null default 'sv';

alter table public.generated_sites
  add column if not exists language text not null default 'sv';

update public.site_leads
set language = coalesce(nullif(language, ''), 'sv')
where language is null or btrim(language) = '';

update public.generated_sites gs
set language = coalesce(nullif(gs.language, ''), nullif(sl.language, ''), 'sv')
from public.site_leads sl
where gs.site_lead_id = sl.id
  and (gs.language is null or btrim(gs.language) = '');

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
  en_seq_id uuid;
  en_list_id uuid;
  new_list_id uuid;
  new_seq_id uuid;
  node_rec record;
  edge_rec record;
  new_node_id uuid;
  send_rank integer;
  english_subjects text[] := array[
    'Quick idea for {{company_name}}',
    'Following up on the demo for {{company_name}}',
    'Worth a quick look for {{company_name}}?',
    'Last follow-up on the site idea'
  ];
  english_bodies text[] := array[
    'Write a short, natural cold email in English to {{company_name}}. Mention that we put together a live website demo for them at {{demo_url}} after looking at {{website}}. Keep it warm, specific and low-pressure. Mention one concrete weakness from {{audit_weakness}} if available. End with one simple question about whether they want us to tailor it further.',
    'Write a brief English follow-up email to {{company_name}}. Refer to the live website demo at {{demo_url}}. Keep it under 90 words, polite and easy to reply to. Mention that we can adapt the text, pages and design to fit their business if relevant.',
    'Write a concise English follow-up email to {{company_name}}. Mention the demo again at {{demo_url}} and make the value clearer in plain language. No pressure. One concrete CTA only.',
    'Write a final short English follow-up email to {{company_name}}. Mention the live demo at {{demo_url}} one last time and invite a simple yes/no reply if they want changes or want us to leave it there.'
  ];
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
      cl.description as list_description
    from public.sequences s
    left join public.contact_lists cl on cl.id = s.contact_list_id
    where s.name = 'Site Demo Outreach'
  loop
    select s2.id, s2.contact_list_id
    into en_seq_id, en_list_id
    from public.sequences s2
    where s2.user_id = src_seq.user_id
      and s2.name = 'Site Demo Outreach EN'
    limit 1;

    if en_seq_id is null then
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
          coalesce(node_rec.config, '{}'::jsonb)
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

      en_seq_id := new_seq_id;
      en_list_id := new_list_id;
    end if;

    if en_list_id is null then
      insert into public.contact_lists (user_id, name, description)
      values (src_seq.user_id, 'Site Demo Outreach EN', 'English site demo outreach leads')
      returning id into new_list_id;

      update public.sequences
      set contact_list_id = new_list_id
      where id = en_seq_id;

      en_list_id := new_list_id;
    end if;

    update public.sequence_nodes
    set config = jsonb_set(coalesce(config, '{}'::jsonb), '{contact_list_id}', to_jsonb(en_list_id::text), true)
    where sequence_id = en_seq_id
      and node_type = 'trigger';

    send_rank := 0;
    for node_rec in
      select id, config
      from public.sequence_nodes
      where sequence_id = en_seq_id
        and node_type = 'send_email'
      order by position_y, created_at
    loop
      send_rank := send_rank + 1;
      update public.sequence_nodes
      set config = jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(node_rec.config, '{}'::jsonb),
            '{sender_domain}', to_jsonb('foremp.eu'::text), true
          ),
          '{model}', to_jsonb('gpt-4o-mini'::text), true
        ),
        '{subject_prompt}', to_jsonb(english_subjects[least(send_rank, array_length(english_subjects, 1))]), true
      )
      where id = node_rec.id;

      update public.sequence_nodes
      set config = jsonb_set(
        coalesce(config, '{}'::jsonb),
        '{prompt}', to_jsonb(english_bodies[least(send_rank, array_length(english_bodies, 1))]), true
      )
      where id = node_rec.id;
    end loop;
  end loop;
end
$$;
