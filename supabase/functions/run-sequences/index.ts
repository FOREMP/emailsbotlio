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

  // Load verified sending domains once per tick
  const { data: verifiedDomainRows } = await supabase
    .from('sending_domains')
    .select('domain')
    .eq('is_active', true)
    .eq('is_verified', true)
  const verifiedDomains = new Set((verifiedDomainRows ?? []).map((d: any) => d.domain as string))

  // Two-pass query: prioritise follow-ups (last_sent_at NOT NULL) and previously-deferred
  // enrollments before brand-new ones, so yesterday's leftovers and mid-sequence sends
  // drain first.
  const passA = await supabase
    .from('enrollments')
    .select('*')
    .eq('status', 'active')
    .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
    .or('last_sent_at.not.is.null,deferred_at.not.is.null')
    .order('deferred_at', { ascending: true, nullsFirst: false })
    .order('last_sent_at', { ascending: true, nullsFirst: false })
    .limit(MAX_PER_RUN)
  if (passA.error) {
    console.error('[run-sequences] passA failed', passA.error.message)
    return new Response(JSON.stringify({ error: passA.error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const remaining = MAX_PER_RUN - (passA.data?.length ?? 0)
  let passBData: any[] = []
  if (remaining > 0) {
    const passB = await supabase
      .from('enrollments')
      .select('*')
      .eq('status', 'active')
      .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
      .is('last_sent_at', null)
      .is('deferred_at', null)
      .order('created_at', { ascending: true })
      .limit(remaining)
    if (passB.error) {
      console.error('[run-sequences] passB failed', passB.error.message)
    } else {
      passBData = passB.data ?? []
    }
  }

  const due = [...(passA.data ?? []), ...passBData]
  console.log(`[run-sequences] picked ${due.length} due (followups=${passA.data?.length ?? 0}, new=${passBData.length})`)

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

      // Stop sequence if contact has unsubscribed (DNC list or global suppression)
      if (contact.email) {
        const emailLower = contact.email.toLowerCase()
        const [{ data: dnc }, { data: supp }] = await Promise.all([
          supabase.from('do_not_contact').select('id').eq('user_id', enr.user_id).eq('email', emailLower).maybeSingle(),
          supabase.from('suppressed_emails').select('id').eq('email', emailLower).maybeSingle(),
        ])
        if (dnc || supp) {
          await supabase.from('enrollments').update({ status: 'unsubscribed' }).eq('id', enr.id)
          console.log(`[enr ${enr.id}] contact unsubscribed → cancelled`)
          continue
        }
      }

      // Determine current node — prefer wired duplicates
      const wiredTrigger = (nodes ?? []).filter((n: any) => n.node_type === 'trigger')
        .find((n: any) => (edges ?? []).some((e: any) => e.source_node_id === n.id))
        ?? (nodes ?? []).find((n: any) => n.node_type === 'trigger')

      let currentNode = enr.current_node_id
        ? findNodePreferWired(nodes ?? [], edges ?? [], enr.current_node_id)
        : wiredTrigger

      // Recover from stale current_node_id by falling back to the trigger
      if (!currentNode && wiredTrigger) {
        console.warn(`[enr ${enr.id}] stale current_node_id ${enr.current_node_id} → recovering to trigger`)
        currentNode = wiredTrigger
        await supabase.from('enrollments').update({
          current_node_id: wiredTrigger.id,
          last_error: `recovered from missing node ${enr.current_node_id}`,
          error_at: nowIso,
        }).eq('id', enr.id)
      }

      if (!currentNode) {
        console.warn(`[enr ${enr.id}] no current node found → failed`)
        await supabase.from('enrollments').update({
          status: 'failed',
          last_error: 'sequence has no trigger node',
          error_at: nowIso,
        }).eq('id', enr.id)
        failed++; continue
      }

      // If on trigger, advance to next; if no edge from trigger, mark failed (NOT completed)
      if (currentNode.node_type === 'trigger') {
        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) {
          console.warn(`[enr ${enr.id}] trigger has no outgoing edge → failed`)
          await supabase.from('enrollments').update({
            status: 'failed',
            last_error: 'trigger node is not connected to any next step',
            error_at: nowIso,
          }).eq('id', enr.id)
          failed++; continue
        }
        currentNode = (nodes ?? []).find((n: any) => n.id === next.target_node_id)
        if (!currentNode) {
          console.warn(`[enr ${enr.id}] trigger.next target missing → failed`)
          await supabase.from('enrollments').update({
            status: 'failed',
            last_error: 'next node after trigger is missing',
            error_at: nowIso,
          }).eq('id', enr.id)
          failed++; continue
        }
        console.log(`[enr ${enr.id}] advanced trigger → ${currentNode.node_type}(${currentNode.id})`)
      }

      const cfg = currentNode.config ?? {}
      console.log(`[enr ${enr.id}] processing ${currentNode.node_type}(${currentNode.id})`)

      // Daily-limit (throttle) node: count today's send_email-after-this-node activity
      if (currentNode.node_type === 'throttle') {
        const max = Number(cfg.max_per_day ?? 50)
        const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
        const { count } = await supabase
          .from('contact_activity')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', enr.sequence_id)
          .eq('node_id', currentNode.id)
          .eq('activity_type', 'throttle_pass')
          .gte('created_at', startOfDay.toISOString())
        if ((count ?? 0) >= max) {
          // Defer this enrollment to next UTC midnight
          const tomorrow = new Date(startOfDay.getTime() + 24 * 3600_000)
          await supabase.from('enrollments').update({ next_send_at: tomorrow.toISOString() }).eq('id', enr.id)
          console.log(`[enr ${enr.id}] throttle full (${count}/${max}) → deferred to ${tomorrow.toISOString()}`)
          continue
        }
        // Mark this pass and advance
        await supabase.from('contact_activity').insert({
          user_id: enr.user_id,
          contact_id: enr.contact_id,
          sequence_id: enr.sequence_id,
          node_id: currentNode.id,
          activity_type: 'throttle_pass',
          metadata: { used: (count ?? 0) + 1, max },
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

      if (currentNode.node_type === 'send_email') {
        let preSenderId: string | null = null

        // Fail fast if user has zero active senders (instead of silent indefinite defer)
        const { data: anyActive } = await supabase
          .from('senders')
          .select('id')
          .eq('user_id', enr.user_id)
          .eq('is_active', true)
          .limit(1)
        if (!anyActive || anyActive.length === 0) {
          console.warn(`[enr ${enr.id}] user has no active senders → failed`)
          await supabase.from('enrollments').update({
            status: 'failed',
            last_error: 'no active senders configured for this account',
            error_at: nowIso,
          }).eq('id', enr.id)
          failed++; continue
        }

        if (cfg.sender_strategy === 'specific' && cfg.sender_id) {
          preSenderId = cfg.sender_id
        } else {
          const { data: pool } = await supabase.from('senders').select('id, from_email').eq('user_id', enr.user_id).eq('is_active', true)
          let candidates = pool ?? []
          if (cfg.sender_strategy === 'brand' && cfg.brand) {
            const filtered = candidates.filter((s: any) => {
              const dom = (s.from_email as string).split('@')[1] ?? ''
              return dom.startsWith(`${cfg.brand}.`) || dom === cfg.brand
            })
            if (filtered.length === 0) {
              console.warn(`[enr ${enr.id}] no senders match brand "${cfg.brand}" → failed`)
              await supabase.from('enrollments').update({
                status: 'failed',
                last_error: `no senders match brand "${cfg.brand}"`,
                error_at: nowIso,
              }).eq('id', enr.id)
              failed++; continue
            }
            candidates = filtered
          }
          for (const c of candidates.sort(() => Math.random() - 0.5)) {
            const { data: rem } = await supabase.rpc('sender_daily_remaining', { _sender_id: c.id })
            if ((rem ?? 0) > 0) { preSenderId = c.id; break }
          }
        }
        if (!preSenderId) {
          const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0)
          await supabase.from('enrollments').update({
            next_send_at: tomorrow.toISOString(),
            last_error: 'all senders at daily cap',
            error_at: nowIso,
          }).eq('id', enr.id)
          console.log(`[enr ${enr.id}] all senders at daily cap → deferred to ${tomorrow.toISOString()}`)
          continue
        }
        if (cfg.sender_strategy === 'specific') {
          const { data: rem } = await supabase.rpc('sender_daily_remaining', { _sender_id: preSenderId })
          if ((rem ?? 0) <= 0) {
            const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0)
            await supabase.from('enrollments').update({
              next_send_at: tomorrow.toISOString(),
              last_error: 'specific sender at daily cap',
              error_at: nowIso,
            }).eq('id', enr.id)
            console.log(`[enr ${enr.id}] specific sender at daily cap → deferred`)
            continue
          }
        }

        const r = await supabase.functions.invoke('send-cold-email', {
          body: {
            user_id: enr.user_id,
            sender_id: preSenderId,
            strategy: 'specific',
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

      if (currentNode.node_type === 'schedule') {
        const next = (edges ?? []).find((e: any) => e.source_node_id === currentNode.id)
        if (!next) { await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id); continue }
        const tod = String(cfg.time_of_day ?? '09:00')
        const [hh, mm] = tod.split(':').map((x: string) => Number(x))
        const allowedDays: string[] = Array.isArray(cfg.days) ? cfg.days : []
        const dayMap = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
        const TZ = 'Europe/Stockholm'

        // Get current time as Stockholm wall-clock components
        const fmt = new Intl.DateTimeFormat('en-US', {
          timeZone: TZ, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
        })
        const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value])) as any

        // Build a UTC instant for a given Stockholm wall-clock date+time (handles DST via offset diff)
        const stockholmWallToUTC = (y: number, mo: number, d: number, h: number, mi: number): Date => {
          // Initial guess: treat the wall-clock as if it were UTC
          const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0))
          // What Stockholm thinks the guess instant is
          const sParts = Object.fromEntries(
            new Intl.DateTimeFormat('en-US', {
              timeZone: TZ, hour12: false,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
            }).formatToParts(guess).map((p) => [p.type, p.value])
          ) as any
          const asStockholm = Date.UTC(
            Number(sParts.year), Number(sParts.month) - 1, Number(sParts.day),
            Number(sParts.hour), Number(sParts.minute), Number(sParts.second)
          )
          const offsetMs = asStockholm - guess.getTime() // Stockholm is ahead of UTC
          return new Date(guess.getTime() - offsetMs)
        }

        const todayY = Number(parts.year), todayMo = Number(parts.month), todayD = Number(parts.day)
        const nowStockholmMins = Number(parts.hour) * 60 + Number(parts.minute)
        const slotMins = (hh || 0) * 60 + (mm || 0)
        const todayName = parts.weekday as string

        // Candidate: today's slot in Stockholm
        let candidate = stockholmWallToUTC(todayY, todayMo, todayD, hh || 0, mm || 0)
        let candidateDayName = todayName
        if (nowStockholmMins >= slotMins) {
          // Move to tomorrow's slot
          const tmr = new Date(Date.UTC(todayY, todayMo - 1, todayD + 1))
          candidate = stockholmWallToUTC(tmr.getUTCFullYear(), tmr.getUTCMonth() + 1, tmr.getUTCDate(), hh || 0, mm || 0)
          candidateDayName = dayMap[tmr.getUTCDay()]
        }
        // Walk forward until allowed day (hard cap at 8 days)
        let foundAllowed = allowedDays.length === 0 || allowedDays.includes(candidateDayName)
        for (let i = 0; i < 8 && !foundAllowed; i++) {
          const nextDay = new Date(candidate.getTime() + 86_400_000)
          candidate = stockholmWallToUTC(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), hh || 0, mm || 0)
          candidateDayName = dayMap[nextDay.getUTCDay()]
          if (allowedDays.length === 0 || allowedDays.includes(candidateDayName)) { foundAllowed = true; break }
        }
        if (!foundAllowed) {
          console.warn(`[enr ${enr.id}] schedule: no allowed day within 8 days → failed`)
          await supabase.from('enrollments').update({
            status: 'failed',
            last_error: `schedule node has no valid day within 8 days (allowed: ${allowedDays.join(',') || 'none'})`,
            error_at: nowIso,
          }).eq('id', enr.id)
          failed++; continue
        }

        const dayAllowedToday = allowedDays.length === 0 || allowedDays.includes(todayName)
        if (dayAllowedToday && nowStockholmMins >= slotMins) {
          await supabase.from('enrollments').update({
            current_node_id: next.target_node_id,
            next_send_at: nowIso,
          }).eq('id', enr.id)
          advanced++
          console.log(`[enr ${enr.id}] schedule passed (today ${tod} Stockholm) → advance`)
          continue
        }
        await supabase.from('enrollments').update({
          current_node_id: currentNode.id,
          next_send_at: candidate.toISOString(),
        }).eq('id', enr.id)
        console.log(`[enr ${enr.id}] schedule → wait until ${candidate.toISOString()} (${tod} Stockholm)`)
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
