import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_PER_RUN = 50

function msFromUnit(n: number, unit: string): number {
  switch (unit) {
    case 'minutes': return n * 60_000
    case 'hours': return n * 3_600_000
    case 'days': return n * 86_400_000
    default: return n * 86_400_000
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, svc)

  const nowIso = new Date().toISOString()

  // Pick due enrollments
  const { data: due, error } = await supabase
    .from('enrollments')
    .select('*')
    .eq('status', 'active')
    .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
    .limit(MAX_PER_RUN)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  let processed = 0
  let advanced = 0
  let sent = 0
  const errors: any[] = []

  for (const enr of due ?? []) {
    processed++
    try {
      // Load nodes + edges for this sequence
      const [{ data: nodes }, { data: edges }, { data: contact }] = await Promise.all([
        supabase.from('sequence_nodes').select('*').eq('sequence_id', enr.sequence_id),
        supabase.from('sequence_edges').select('*').eq('sequence_id', enr.sequence_id),
        supabase.from('contacts').select('*').eq('id', enr.contact_id).maybeSingle(),
      ])

      if (!contact) {
        await supabase.from('enrollments').update({ status: 'failed' }).eq('id', enr.id)
        continue
      }

      // Determine current node — if null, find trigger
      let currentNode = enr.current_node_id
        ? (nodes ?? []).find((n: any) => n.id === enr.current_node_id)
        : (nodes ?? []).find((n: any) => n.node_type === 'trigger')

      if (!currentNode) {
        await supabase.from('enrollments').update({ status: 'failed' }).eq('id', enr.id)
        continue
      }

      // If we're on a trigger, immediately advance off it
      if (currentNode.node_type === 'trigger') {
        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) { await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id); continue }
        currentNode = (nodes ?? []).find((n: any) => n.id === next.target_node_id)
        if (!currentNode) { await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id); continue }
      }

      const cfg = currentNode.config ?? {}

      if (currentNode.node_type === 'send_email') {
        const r = await supabase.functions.invoke('send-cold-email', {
          body: {
            user_id: enr.user_id,
            sender_id: cfg.sender_strategy === 'specific' ? cfg.sender_id : undefined,
            strategy: cfg.sender_strategy === 'brand' ? 'brand' : 'all',
            brand: cfg.brand,
            contact,
            sequence_id: enr.sequence_id,
            enrollment_id: enr.id,
            node_id: currentNode.id,
            mode: cfg.mode ?? 'ai',
            subject: cfg.subject,
            body: cfg.body,
            prompt: cfg.prompt,
            subject_hint: cfg.subject_hint,
          },
        })
        if (r.error) { errors.push({ enr: enr.id, err: r.error.message }); continue }
        sent++

        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) { await supabase.from('enrollments').update({ status: 'completed', last_sent_at: nowIso }).eq('id', enr.id); continue }
        await supabase.from('enrollments').update({
          current_node_id: next.target_node_id,
          last_sent_at: nowIso,
          next_send_at: nowIso, // process next node immediately on next tick
        }).eq('id', enr.id)
        advanced++
        continue
      }

      if (currentNode.node_type === 'wait') {
        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) { await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id); continue }
        const waitMs = msFromUnit(Number(cfg.duration ?? 1), cfg.unit ?? 'days')
        const nextAt = new Date(Date.now() + waitMs).toISOString()
        await supabase.from('enrollments').update({
          current_node_id: next.target_node_id,
          next_send_at: nextAt,
        }).eq('id', enr.id)
        advanced++
        continue
      }

      if (currentNode.node_type === 'log_activity') {
        await supabase.from('contact_activity').insert({
          user_id: enr.user_id,
          contact_id: enr.contact_id,
          sequence_id: enr.sequence_id,
          node_id: currentNode.id,
          activity_type: cfg.activity_type || 'custom',
          metadata: { note: cfg.note ?? null },
        })
        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) { await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id); continue }
        await supabase.from('enrollments').update({
          current_node_id: next.target_node_id,
          next_send_at: nowIso,
        }).eq('id', enr.id)
        advanced++
        continue
      }

      if (currentNode.node_type === 'condition') {
        // No tracking yet — default to false branch
        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id && e.source_handle === 'false')
          ?? (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) { await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id); continue }
        await supabase.from('enrollments').update({
          current_node_id: next.target_node_id,
          next_send_at: nowIso,
        }).eq('id', enr.id)
        advanced++
        continue
      }

      if (currentNode.node_type === 'end') {
        await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id)
        continue
      }

      // Unknown node — skip safely
      await supabase.from('enrollments').update({ status: 'failed' }).eq('id', enr.id)
    } catch (e: any) {
      errors.push({ enr: enr.id, err: e.message })
    }
  }

  return new Response(JSON.stringify({ processed, advanced, sent, errors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
