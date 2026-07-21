import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_PER_RUN = 200
const PER_DOMAIN_DAILY_CAP = 80
const STOCKHOLM_TZ = 'Europe/Stockholm'

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

// Walk edges backwards from a node to find the nearest upstream schedule node.
// Used when we need to defer a send: instead of pinning to UTC midnight (which
// ignores the configured local time-of-day), rewind to the schedule so its
// next-slot logic computes the correct local fire time on the next tick.
function findUpstreamScheduleId(nodes: any[], edges: any[], fromNodeId: string): string | null {
  const seen = new Set<string>()
  let frontier: string[] = [fromNodeId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      if (seen.has(id)) continue
      seen.add(id)
      const incoming = edges.filter((e: any) => e.target_node_id === id)
      for (const e of incoming) {
        const src = nodes.find((n: any) => n.id === e.source_node_id)
        if (!src) continue
        if (src.node_type === 'schedule') return src.id
        next.push(src.id)
      }
    }
    frontier = next
  }
  return null
}

function nextEdgeFrom(nodes: any[], edges: any[], sourceNodeId: string) {
  const candidates = (edges ?? []).filter((e: any) => e.source_node_id === sourceNodeId)
  if (candidates.length <= 1) return candidates[0] ?? null
  // Prefer the currently saved canvas edge over older duplicate "out" edges.
  const byHandle = candidates.find((e: any) => e.source_handle === 'default')
    ?? candidates.find((e: any) => e.source_handle === 'out')
  if (byHandle) return byHandle
  // If a schedule exists directly after this node, prefer it so business-hour gates
  // cannot be bypassed by stale direct edges left from older graph rewires.
  return candidates.find((e: any) => nodes.some((n: any) => n.id === e.target_node_id && n.node_type === 'schedule'))
    ?? candidates[0]
}

function sequenceDailyCap(nodes: any[]): number | null {
  const caps = (nodes ?? [])
    .filter((n: any) => n.node_type === 'throttle')
    .map((n: any) => Number(n.config?.max_per_day))
    .filter((n: number) => Number.isFinite(n) && n > 0)
  return caps.length ? Math.min(...caps) : null
}

function startOfStockholmDayUtc(now = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: STOCKHOLM_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((p) => [p.type, p.value])) as any
  return stockholmWallToUTC(Number(parts.year), Number(parts.month), Number(parts.day), 0, 0)
}

function stockholmWallToUTC(y: number, mo: number, d: number, h: number, mi: number): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, 0))
  const sParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: STOCKHOLM_TZ, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(guess).map((p) => [p.type, p.value])
  ) as any
  const asStockholm = Date.UTC(
    Number(sParts.year), Number(sParts.month) - 1, Number(sParts.day),
    Number(sParts.hour), Number(sParts.minute), Number(sParts.second)
  )
  return new Date(guess.getTime() - (asStockholm - guess.getTime()))
}

function nextStockholmMidnightUtc(now = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: STOCKHOLM_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((p) => [p.type, p.value])) as any
  const next = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1))
  return stockholmWallToUTC(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, svc)

  const nowIso = new Date().toISOString()

  // Cheap pre-check: are there ANY due enrollments? If not, skip everything.
  const dueProbe = await supabase
    .from('enrollments')
    .select('id', { head: true, count: 'exact' })
    .in('status', ['active', 'waiting_capacity'])
    .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
    .limit(1)
  if (!dueProbe.error && (dueProbe.count ?? 0) === 0) {
    return new Response(JSON.stringify({ ok: true, idle: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Load verified sending domains once per tick
  const { data: verifiedDomainRows } = await supabase
    .from('sending_domains')
    .select('domain')
    .eq('is_active', true)
    .eq('is_verified', true)
  const verifiedDomains = new Set((verifiedDomainRows ?? []).map((d: any) => d.domain as string))

  // Pick due enrollments (active OR previously waiting on capacity).
  // Prioritise follow-ups + capacity-waiters first, then brand-new enrollments.
  const passA = await supabase
    .from('enrollments')
    .select('*')
    .in('status', ['active', 'waiting_capacity'])
    .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
    .not('last_sent_at', 'is', null)
    .order('last_sent_at', { ascending: true })
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
      .in('status', ['active', 'waiting_capacity'])
      .or(`next_send_at.is.null,next_send_at.lte.${nowIso}`)
      .is('last_sent_at', null)
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

  const MAX_ATTEMPTS = 5

  let processed = 0
  let advanced = 0
  let sent = 0
  let failed = 0
  const errors: any[] = []

  // Per-tick cache of domain usage (Stockholm-day approximated as UTC-day for query efficiency).
  // We count today's sends grouped by sender domain to enforce PER_DOMAIN_DAILY_CAP.
  const domainSentToday = new Map<string, number>()
  const domainCounted = new Set<string>() // domains we've already initialised from DB

  async function getDomainRemaining(domain: string): Promise<number> {
    if (!domainCounted.has(domain)) {
      // Fetch all sender ids for this domain (any user) — domain reputation is shared regardless of user
      const { data: dSenders } = await supabase
        .from('senders')
        .select('id, from_email')
        .ilike('from_email', `%@${domain}`)
      const ids = (dSenders ?? []).map((s: any) => s.id)
      let used = 0
      if (ids.length > 0) {
        const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
        const { count } = await supabase
          .from('sent_emails')
          .select('id', { count: 'exact', head: true })
          .in('sender_id', ids)
          .in('status', ['sent', 'queued'])
          .gte('sent_at', startOfDay.toISOString())
        used = count ?? 0
      }
      domainSentToday.set(domain, used)
      domainCounted.add(domain)
    }
    return Math.max(0, PER_DOMAIN_DAILY_CAP - (domainSentToday.get(domain) ?? 0))
  }

  function bumpDomain(domain: string) {
    domainSentToday.set(domain, (domainSentToday.get(domain) ?? 0) + 1)
  }

  // Per-invocation cache of sequence graphs — avoids re-reading nodes/edges
  // for every enrollment in the same tick.
  const graphCache = new Map<string, { nodes: any[]; edges: any[] }>()
  async function getSequenceGraph(sequenceId: string) {
    const hit = graphCache.get(sequenceId)
    if (hit) return hit
    const [nodesRes, edgesRes] = await Promise.all([
      supabase.from('sequence_nodes').select('*').eq('sequence_id', sequenceId),
      supabase.from('sequence_edges').select('*').eq('sequence_id', sequenceId),
    ])
    const g = { nodes: nodesRes.data ?? [], edges: edgesRes.data ?? [] }
    graphCache.set(sequenceId, g)
    return g
  }

  for (const enr of due ?? []) {
    processed++
    try {
      // ATOMIC CLAIM: prevent concurrent invocations (cron + manual trigger) from
      // processing the same enrollment twice. We bump updated_at and require it to
      // still match what we read; if another worker already claimed/advanced this
      // enrollment, the update affects 0 rows and we skip.
      const claim = await supabase
        .from('enrollments')
        .update({ updated_at: nowIso })
        .eq('id', enr.id)
        .eq('updated_at', enr.updated_at)
        .select('id')
      if (!claim.data || claim.data.length === 0) {
        console.log(`[enr ${enr.id}] skipped — already claimed by another worker`)
        continue
      }
      // Per-invocation cache: the same sequence is walked by many enrollments in
      // one tick. Fetch nodes+edges once per sequence_id instead of per enrollment
      // (was ~48k SELECTs/week on sequence_nodes+edges alone → main IO drain).
      const graph = await getSequenceGraph(enr.sequence_id)
      const nodes = graph.nodes
      const edges = graph.edges
      const { data: contact } = await supabase.from('contacts').select('*').eq('id', enr.contact_id).maybeSingle()

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

      // Daily-limit (throttle) node: count *actual sends gated by THIS throttle*
      // today. Each throttle node is independent — a throttle in front of the first
      // email does not consume the budget of a throttle on a follow-up branch.
      // We tag email_sent activities with metadata.throttle_node_id when they pass
      // through a throttle, and count by that tag here.
      if (currentNode.node_type === 'throttle') {
        const max = Number(cfg.max_per_day ?? 50)
        const startOfDay = startOfStockholmDayUtc()
        const { count } = await supabase
          .from('contact_activity')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', enr.sequence_id)
          .eq('activity_type', 'email_sent')
          .gte('created_at', startOfDay.toISOString())
        // This is intentionally a sequence-wide daily cap, not just this one
        // throttle node. The Site Demo number is the total daily outreach volume,
        // and the user already includes follow-ups in that calculation.
        if ((count ?? 0) >= max) {
          const tomorrow = nextStockholmMidnightUtc()
          await supabase.from('enrollments').update({
            next_send_at: tomorrow.toISOString(),
            status: 'waiting_capacity',
            last_error: `daily sequence limit reached (${count}/${max}) — resumes next Stockholm day`,
          }).eq('id', enr.id)
          console.log(`[enr ${enr.id}] sequence cap full (${count}/${max}) → waiting_capacity until ${tomorrow.toISOString()}`)
          continue
        }
        // Capacity available — advance and remember which throttle gated the next send.
        const next = nextEdgeFrom(nodes ?? [], edges ?? [], currentNode.id)
        if (!next) { await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id); continue }
        await supabase.from('enrollments').update({
          current_node_id: next.target_node_id,
          next_send_at: nowIso,
          status: 'active',
          last_error: `__pending_throttle:${currentNode.id}`,
        }).eq('id', enr.id)
        advanced++
        continue
      }

      if (currentNode.node_type === 'send_email') {
        // Global sequence daily limit: applies to first emails AND follow-ups.
        const cap = sequenceDailyCap(nodes ?? [])
        if (cap) {
          const startOfDay = startOfStockholmDayUtc()
          const { count } = await supabase
            .from('contact_activity')
            .select('id', { count: 'exact', head: true })
            .eq('sequence_id', enr.sequence_id)
            .eq('activity_type', 'email_sent')
            .gte('created_at', startOfDay.toISOString())
          if ((count ?? 0) >= cap) {
            const upstreamSched = findUpstreamScheduleId(nodes ?? [], edges ?? [], currentNode.id)
            const tomorrow = nextStockholmMidnightUtc()
            await supabase.from('enrollments').update({
              current_node_id: upstreamSched ?? currentNode.id,
              next_send_at: tomorrow.toISOString(),
              deferred_at: nowIso,
              status: 'waiting_capacity',
              last_error: `daily sequence limit reached (${count}/${cap}) — resumes next scheduled slot`,
              error_at: nowIso,
            }).eq('id', enr.id)
            console.log(`[enr ${enr.id}] global daily cap full (${count}/${cap}) → waiting_capacity (schedule=${upstreamSched ?? 'none'})`)
            continue
          }
        }

        // SAME-DAY GUARD: never send to the same contact twice on the same UTC day.
        // Defers this enrollment to next UTC midnight if a send already exists today.
        {
          const startOfDay = startOfStockholmDayUtc()
          const { data: alreadyToday } = await supabase
            .from('sent_emails')
            .select('id')
            .eq('contact_id', enr.contact_id)
            .eq('user_id', enr.user_id)
            .in('status', ['sent', 'queued'])
            .gte('sent_at', startOfDay.toISOString())
            .limit(1)
          if (alreadyToday && alreadyToday.length > 0) {
            const tomorrow = nextStockholmMidnightUtc()
            const upstreamSched = findUpstreamScheduleId(nodes ?? [], edges ?? [], currentNode.id)
            await supabase.from('enrollments').update({
              current_node_id: upstreamSched ?? enr.current_node_id,
              next_send_at: tomorrow.toISOString(),
              deferred_at: nowIso,
              last_error: 'same-day double-send guard — already sent to this contact today',
              error_at: nowIso,
            }).eq('id', enr.id)
            console.log(`[enr ${enr.id}] same-day guard tripped → deferred (rewound to schedule=${upstreamSched ?? 'none'})`)
            continue
          }
        }
        let preSenderId: string | null = null

        // Fail fast if user has zero active senders (instead of silent indefinite defer)
        const { data: anyActive } = await supabase
          .from('senders')
          .select('id, from_email')
          .eq('user_id', enr.user_id)
          .eq('is_active', true)
        if (!anyActive || anyActive.length === 0) {
          console.warn(`[enr ${enr.id}] user has no active senders → failed`)
          await supabase.from('enrollments').update({
            status: 'failed',
            last_error: 'no active senders configured for this account',
            error_at: nowIso,
          }).eq('id', enr.id)
          failed++; continue
        }

        // Restrict to verified-domain senders only
        const verifiedActive = anyActive.filter((s: any) => verifiedDomains.has((s.from_email as string).split('@')[1]))
        if (verifiedActive.length === 0) {
          console.warn(`[enr ${enr.id}] no verified-domain senders → failed`)
          await supabase.from('enrollments').update({
            status: 'failed',
            last_error: `no verified sending domain — only ${[...verifiedDomains].join(', ') || '(none)'} can send. Verify your other domains in Cloud → Emails.`,
            error_at: nowIso,
          }).eq('id', enr.id)
          failed++; continue
        }

        // STICKY SENDER: if this enrollment already has an assigned sender from
        // a prior send, reuse it so the recipient sees the same From across the
        // first email and every follow-up (matches subject-based threading).
        const isSenderEligible = async (sid: string): Promise<{ ok: boolean; reason?: string }> => {
          const match = verifiedActive.find((s: any) => s.id === sid)
          if (!match) return { ok: false, reason: 'sender no longer active or domain unverified' }
          const dom = (match.from_email as string).split('@')[1]
          if (cfg.sender_domain && dom !== cfg.sender_domain) return { ok: false, reason: `assigned sender is not on ${cfg.sender_domain}` }
          const { data: rem } = await supabase.rpc('sender_daily_remaining', { _sender_id: sid })
          if ((rem ?? 0) <= 0) return { ok: false, reason: 'assigned sender at daily cap' }
          const domRem = await getDomainRemaining(dom)
          if (domRem <= 0) return { ok: false, reason: `domain ${dom} at daily cap (${PER_DOMAIN_DAILY_CAP})` }
          return { ok: true }
        }

        if (enr.assigned_sender_id) {
          const check = await isSenderEligible(enr.assigned_sender_id)
          if (check.ok) {
            preSenderId = enr.assigned_sender_id
            console.log(`[enr ${enr.id}] reusing sticky sender ${preSenderId}`)
          } else {
            console.warn(`[enr ${enr.id}] sticky sender ${enr.assigned_sender_id} ineligible: ${check.reason}`)
            // Fall through to rotation logic below; we will overwrite assigned_sender_id on success.
          }
        }

        if (!preSenderId) {
          if (cfg.sender_strategy === 'specific' && cfg.sender_id) {
            const specific = anyActive.find((s: any) => s.id === cfg.sender_id)
            if (!specific) {
              await supabase.from('enrollments').update({
                status: 'failed',
                last_error: 'configured specific sender no longer exists or is inactive',
                error_at: nowIso,
              }).eq('id', enr.id)
              failed++; continue
            }
            const dom = (specific.from_email as string).split('@')[1]
            if (cfg.sender_domain && dom !== cfg.sender_domain) {
              await supabase.from('enrollments').update({
                status: 'failed',
                last_error: `configured sender must use ${cfg.sender_domain}`,
                error_at: nowIso,
              }).eq('id', enr.id)
              failed++; continue
            }
            if (!verifiedDomains.has(dom)) {
              await supabase.from('enrollments').update({
                status: 'failed',
                last_error: `sender domain "${dom}" not verified with Lovable Emails`,
                error_at: nowIso,
              }).eq('id', enr.id)
              failed++; continue
            }
            preSenderId = cfg.sender_id
          } else {
            let candidates = verifiedActive
            if (cfg.sender_domain) {
              candidates = candidates.filter((s: any) => (s.from_email as string).split('@')[1] === cfg.sender_domain)
              if (candidates.length === 0) {
                console.warn(`[enr ${enr.id}] no verified senders on domain "${cfg.sender_domain}" → failed`)
                await supabase.from('enrollments').update({
                  status: 'failed',
                  last_error: `no verified active senders on ${cfg.sender_domain}`,
                  error_at: nowIso,
                }).eq('id', enr.id)
                failed++; continue
              }
            }
            if (cfg.sender_strategy === 'brand' && cfg.brand) {
              const filtered = candidates.filter((s: any) => {
                const dom = (s.from_email as string).split('@')[1] ?? ''
                return dom.startsWith(`${cfg.brand}.`) || dom === cfg.brand
              })
              if (filtered.length === 0) {
                console.warn(`[enr ${enr.id}] no verified senders match brand "${cfg.brand}" → failed`)
                await supabase.from('enrollments').update({
                  status: 'failed',
                  last_error: `no verified senders match brand "${cfg.brand}"`,
                  error_at: nowIso,
                }).eq('id', enr.id)
                failed++; continue
              }
              candidates = filtered
            }
            for (const c of candidates.sort(() => Math.random() - 0.5)) {
              const { data: rem } = await supabase.rpc('sender_daily_remaining', { _sender_id: c.id })
              if ((rem ?? 0) <= 0) continue
              const dom = (c.from_email as string).split('@')[1]
              const domRem = await getDomainRemaining(dom)
              if (domRem <= 0) continue
              preSenderId = c.id; break
            }
          }
        }
        if (!preSenderId) {
          // All eligible senders at daily cap — defer to next UTC midnight and surface
          // it as a visible "waiting_capacity" status so the UI can show it.
          const tomorrow = nextStockholmMidnightUtc()
          const upstreamSched = findUpstreamScheduleId(nodes ?? [], edges ?? [], currentNode.id)
          await supabase.from('enrollments').update({
            current_node_id: upstreamSched ?? enr.current_node_id,
            next_send_at: tomorrow.toISOString(),
            deferred_at: nowIso,
            status: 'waiting_capacity',
            last_error: 'all eligible senders at daily cap — resumes at next scheduled slot',
            error_at: nowIso,
          }).eq('id', enr.id)
          console.log(`[enr ${enr.id}] all senders at daily cap → waiting_capacity (rewound to schedule=${upstreamSched ?? 'none'})`)
          continue
        }
        if (cfg.sender_strategy === 'specific' && !enr.assigned_sender_id) {
          const { data: rem } = await supabase.rpc('sender_daily_remaining', { _sender_id: preSenderId })
          if ((rem ?? 0) <= 0) {
            const tomorrow = nextStockholmMidnightUtc()
            const upstreamSched = findUpstreamScheduleId(nodes ?? [], edges ?? [], currentNode.id)
            await supabase.from('enrollments').update({
              current_node_id: upstreamSched ?? enr.current_node_id,
              next_send_at: tomorrow.toISOString(),
              deferred_at: nowIso,
              status: 'waiting_capacity',
              last_error: 'specific sender at daily cap — resumes at next scheduled slot',
              error_at: nowIso,
            }).eq('id', enr.id)
            console.log(`[enr ${enr.id}] specific sender at daily cap → waiting_capacity (rewound to schedule=${upstreamSched ?? 'none'})`)
            continue
          }
        }

        // If the previous tick advanced through a throttle, it stamped the throttle id
        // into last_error as `__pending_throttle:<id>`. Forward it so send-cold-email
        // tags the email_sent activity for accurate throttle accounting.
        let pendingThrottleId: string | null = null
        if (typeof enr.last_error === 'string' && enr.last_error.startsWith('__pending_throttle:')) {
          pendingThrottleId = enr.last_error.slice('__pending_throttle:'.length) || null
        }

        // Detect follow-up: only after the enrollment itself has recorded a
        // successful last_sent_at. This keeps retries of a failed first email
        // from being treated as follow-ups because of old failed/test send logs.
        // reuse the original subject prefixed with "Re: " so most mail clients
        // visually thread the follow-up with the first message. (The Lovable
        // email SDK doesn't expose In-Reply-To headers, so subject-based
        // threading is the best-effort fallback.)
        let subjectOverride: string | null = null
        let isFollowup = false
        if (enr.last_sent_at) {
          // Pick the most recent ORIGINAL (non-"Re:") subject for this
          // enrollment, ignoring stale subjects from prior test runs by only
          // considering sends at/after the enrollment was (re)activated.
          const sinceIso = enr.updated_at ?? enr.created_at ?? new Date(0).toISOString()
          const { data: priors } = await supabase
            .from('sent_emails')
            .select('subject, sent_at')
            .eq('enrollment_id', enr.id)
            .eq('status', 'sent')
            .gte('sent_at', sinceIso)
            .order('sent_at', { ascending: false })
            .limit(20)
          const original = (priors ?? []).find((p: any) => p.subject && !/^re:\s*/i.test(p.subject))
          if (original?.subject) {
            subjectOverride = original.subject
            isFollowup = true
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
            throttle_node_id: pendingThrottleId,
            mode: cfg.mode ?? 'ai',
            subject: cfg.subject,
            body: cfg.body,
            prompt: cfg.prompt,
            subject_prompt: cfg.subject_prompt ?? cfg.subject_hint,
            subject_hint: cfg.subject_hint, // legacy
            model: cfg.model,
            subject_override: subjectOverride,
            is_followup: isFollowup,
          },
        })
        if (r.error || (r.data as any)?.error) {
          const msg = (r.data as any)?.error || r.error?.message || 'unknown send error'
          const nextAttempt = (enr.attempt_count ?? 0) + 1
          console.error(`[enr ${enr.id}] send-cold-email failed (attempt ${nextAttempt}/${MAX_ATTEMPTS}): ${msg}`)
          errors.push({ enr: enr.id, err: msg, attempt: nextAttempt })
          if (nextAttempt >= MAX_ATTEMPTS) {
            await supabase.from('enrollments').update({
              status: 'failed',
              attempt_count: nextAttempt,
              last_error: `send failed after ${MAX_ATTEMPTS} attempts: ${msg}`,
              error_at: nowIso,
            }).eq('id', enr.id)
            failed++
          } else {
            // Exponential-ish back-off: 5min, 15min, 45min, 2h, ...
            const backoffMin = 5 * Math.pow(3, nextAttempt - 1)
            await supabase.from('enrollments').update({
              attempt_count: nextAttempt,
              next_send_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
              last_error: msg,
              error_at: nowIso,
            }).eq('id', enr.id)
          }
          continue
        }
        sent++
        // Bump per-domain in-memory counter so subsequent enrollments in this same
        // tick respect PER_DOMAIN_DAILY_CAP without re-querying the DB.
        {
          const senderRow = (anyActive ?? []).find((s: any) => s.id === preSenderId)
          const dom = senderRow ? (senderRow.from_email as string).split('@')[1] : null
          if (dom) bumpDomain(dom)
        }
        console.log(`[enr ${enr.id}] email sent (sender=${preSenderId})`)

        // Persist sticky sender so all follow-ups use the same From
        const stickyUpdate: Record<string, unknown> = {}
        if (enr.assigned_sender_id !== preSenderId) {
          stickyUpdate.assigned_sender_id = preSenderId
        }

        const next = nextEdgeFrom(nodes ?? [], edges ?? [], currentNode.id)
        if (!next) {
          await supabase.from('enrollments').update({
            status: 'completed', last_sent_at: nowIso, deferred_at: null,
            attempt_count: 0, last_error: null,
            ...stickyUpdate,
          }).eq('id', enr.id)
          console.log(`[enr ${enr.id}] no next after send → completed`)
          continue
        }
        await supabase.from('enrollments').update({
          current_node_id: next.target_node_id,
          last_sent_at: nowIso,
          next_send_at: nowIso,
          deferred_at: null,
          status: 'active',
          attempt_count: 0,
          last_error: null,
          ...stickyUpdate,
        }).eq('id', enr.id)
        advanced++
        continue
      }

      if (currentNode.node_type === 'schedule') {
        const next = nextEdgeFrom(nodes ?? [], edges ?? [], currentNode.id)
        if (!next) { await supabase.from('enrollments').update({ status: 'completed' }).eq('id', enr.id); continue }
        const tod = String(cfg.time_of_day ?? '09:00')
        const [hh, mm] = tod.split(':').map((x: string) => Number(x))
        const allowedDays: string[] = Array.isArray(cfg.days) ? cfg.days : []
        const dayMap = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
        const TZ = STOCKHOLM_TZ

        // Get current time as Stockholm wall-clock components
        const fmt = new Intl.DateTimeFormat('en-US', {
          timeZone: TZ, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
        })
        const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value])) as any

        // Build a UTC instant for a given Stockholm wall-clock date+time (handles DST via offset diff)
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

        // Only fire within a 30-minute grace window AFTER the configured slot.
        // Outside the window, defer to the next valid slot (today or future day).
        // This prevents a "Mon–Fri 18:00" schedule from firing at e.g. 22:00
        // just because an enrollment was reset late in the day.
        const SCHEDULE_GRACE_MINS = 30
        const dayAllowedToday = allowedDays.length === 0 || allowedDays.includes(todayName)
        const inGraceWindow = nowStockholmMins >= slotMins && nowStockholmMins < slotMins + SCHEDULE_GRACE_MINS
        if (dayAllowedToday && inGraceWindow) {
          await supabase.from('enrollments').update({
            current_node_id: next.target_node_id,
            next_send_at: nowIso,
          }).eq('id', enr.id)
          advanced++
          console.log(`[enr ${enr.id}] schedule passed (today ${tod} Stockholm, in grace window) → advance`)
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
        const next = nextEdgeFrom(nodes ?? [], edges ?? [], currentNode.id)
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
        const next = nextEdgeFrom(nodes ?? [], edges ?? [], currentNode.id)
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
