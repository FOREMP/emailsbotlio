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

// Find the best instance of a node by id, preferring ones that have outgoing edges
function findNodePreferWired(nodes: any[], edges: any[], id: string) {
  const matches = nodes.filter((n) => n.id === id)
  if (matches.length <= 1) return matches[0]
  return matches.find((n) => edges.some((e) => e.source_node_id === n.id)) ?? matches[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, svc)

  const nowIso = new Date().toISOString()

  const { data: due, error } = await supabase
    .from('enrollments')
    .select('*')
    .eq('status', 'active')
    .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
    .limit(MAX_PER_RUN)

  if (error) {
    console.error('[run-sequences] enrollments query failed', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  console.log(`[run-sequences] picked ${due?.length ?? 0} due enrollments`)

  let processed = 0
  let advanced = 0
  let sent = 0
  let failed = 0
  const errors: any[] = []

  for (const enr of due ?? []) {
    processed++
    try {
      const [{ data: nodes }, { data: edges }, { data: contact }] = await Promise.all([
        supabase.from('sequence_nodes').select('*').eq('sequence_id', enr.sequence_id),
        supabase.from('sequence_edges').select('*').eq('sequence_id', enr.sequence_id),
        supabase.from('contacts').select('*').eq('id', enr.contact_id).maybeSingle(),
      ])

      if (!contact) {
        console.warn(`[enr ${enr.id}] contact missing → failed`)
        await supabase.from('enrollments').update({ status: 'failed' }).eq('id', enr.id)
        failed++; continue
      }

      // Determine current node — prefer wired duplicates
      let currentNode = enr.current_node_id
        ? findNodePreferWired(nodes ?? [], edges ?? [], enr.current_node_id)
        : (nodes ?? []).filter((n: any) => n.node_type === 'trigger')
            .find((n: any) => (edges ?? []).some((e: any) => e.source_node_id === n.id))
          ?? (nodes ?? []).find((n: any) => n.node_type === 'trigger')

      if (!currentNode) {
        console.warn(`[enr ${enr.id}] no current node found → failed`)
        await supabase.from('enrollments').update({ status: 'failed' }).eq('id', enr.id)
        failed++; continue
      }

      // If on trigger, advance to next; if no edge from trigger, mark failed (NOT completed)
      if (currentNode.node_type === 'trigger') {
        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) {
          console.warn(`[enr ${enr.id}] trigger has no outgoing edge → failed`)
          await supabase.from('enrollments').update({ status: 'failed' }).eq('id', enr.id)
          failed++; continue
        }
        currentNode = (nodes ?? []).find((n: any) => n.id === next.target_node_id)
        if (!currentNode) {
          console.warn(`[enr ${enr.id}] trigger.next target missing → failed`)
          await supabase.from('enrollments').update({ status: 'failed' }).eq('id', enr.id)
          failed++; continue
        }
        console.log(`[enr ${enr.id}] advanced trigger → ${currentNode.node_type}(${currentNode.id})`)
      }

      const cfg = currentNode.config ?? {}
      console.log(`[enr ${enr.id}] processing ${currentNode.node_type}(${currentNode.id})`)

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
        if (r.error || (r.data as any)?.error) {
          const msg = (r.data as any)?.error || r.error?.message || 'unknown send error'
          console.error(`[enr ${enr.id}] send-cold-email failed: ${msg}`)
          errors.push({ enr: enr.id, err: msg })
          // Don't immediately mark failed — allow retry next tick by leaving status active
          // but bump next_send_at by 5 min to avoid hot-loop
          await supabase.from('enrollments').update({
            next_send_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          }).eq('id', enr.id)
          continue
        }
        sent++
        console.log(`[enr ${enr.id}] email sent`)

        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) {
          await supabase.from('enrollments').update({ status: 'completed', last_sent_at: nowIso }).eq('id', enr.id)
          console.log(`[enr ${enr.id}] no next after send → completed`)
          continue
        }
        await supabase.from('enrollments').update({
          current_node_id: next.target_node_id,
          last_sent_at: nowIso,
          next_send_at: nowIso,
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
        console.log(`[enr ${enr.id}] wait → next at ${nextAt}`)
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
        console.log(`[enr ${enr.id}] end → completed`)
        continue
      }

      console.warn(`[enr ${enr.id}] unknown node_type ${currentNode.node_type}`)
      await supabase.from('enrollments').update({ status: 'failed' }).eq('id', enr.id)
      failed++
    } catch (e: any) {
      console.error(`[enr ${enr.id}] exception: ${e.message}`)
      errors.push({ enr: enr.id, err: e.message })
    }
  }

  console.log(`[run-sequences] done processed=${processed} sent=${sent} advanced=${advanced} failed=${failed} errors=${errors.length}`)

  return new Response(JSON.stringify({ processed, advanced, sent, failed, errors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
