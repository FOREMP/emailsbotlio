import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const sequenceId = body?.sequence_id;
    if (!sequenceId || typeof sequenceId !== "string") {
      return new Response(JSON.stringify({ error: "sequence_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load sequence
    const { data: seq, error: seqErr } = await supabase
      .from("sequences")
      .select("id, user_id, contact_list_id, status, sender_rotation")
      .eq("id", sequenceId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (seqErr || !seq) {
      return new Response(JSON.stringify({ error: "Sequence not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load all nodes + edges for this sequence so we can resolve a REAL trigger
    const [{ data: allNodes }, { data: allEdges }] = await Promise.all([
      supabase.from("sequence_nodes").select("id, node_type, config").eq("sequence_id", sequenceId),
      supabase.from("sequence_edges").select("source_node_id, target_node_id").eq("sequence_id", sequenceId),
    ]);

    const nodes = allNodes ?? [];
    const edges = allEdges ?? [];

    if (nodes.length === 0) {
      return new Response(JSON.stringify({ error: "Sequence has no nodes" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prefer an explicit trigger node, but fall back to the entry node
    // (any node with no incoming edges that has at least one outgoing edge,
    // or — if the graph is a single chain — just the first node in the chain).
    const triggers = nodes.filter((n) => n.node_type === "trigger");
    let trigger =
      triggers.find((t) => edges.some((e) => e.source_node_id === t.id)) ??
      triggers[0] ?? null;

    if (!trigger) {
      const targetIds = new Set(edges.map((e) => e.target_node_id));
      const sourceIds = new Set(edges.map((e) => e.source_node_id));
      // entry = no incoming edges AND has outgoing edges (or is the only node)
      const entry =
        nodes.find((n) => !targetIds.has(n.id) && sourceIds.has(n.id)) ??
        nodes.find((n) => !targetIds.has(n.id)) ??
        nodes[0];
      trigger = entry;
    }

    if (!trigger) {
      return new Response(JSON.stringify({ error: "Sequence has no entry node" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const triggerHasNext =
      edges.some((e) => e.source_node_id === trigger.id) ||
      ["send_email", "end"].includes(trigger.node_type);
    if (!triggerHasNext) {
      return new Response(JSON.stringify({ error: "Entry node is not connected to any next step" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve contact list — body override > sequence default > trigger node config
    let listId: string | null = body?.list_id ?? seq.contact_list_id ?? null;
    if (!listId) {
      listId = (trigger.config as any)?.contact_list_id ?? null;
    }
    if (!listId) {
      return new Response(JSON.stringify({ error: "Sequence has no contact list" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Optional: bypass cross-sequence "already contacted" skip for this enrollment
    const allowRecontact = body?.allow_recontact === true;

    // Load all contacts in list
    const { data: contacts, error: contactsErr } = await supabase
      .from("contacts")
      .select("id, email")
      .eq("user_id", user.id)
      .eq("list_id", listId);

    if (contactsErr) throw contactsErr;

    // Load DNC + global suppression
    const [{ data: dnc }, { data: supp }] = await Promise.all([
      supabase.from("do_not_contact").select("email").eq("user_id", user.id),
      supabase.from("suppressed_emails").select("email"),
    ]);
    const dncSet = new Set([
      ...((dnc ?? []).map((d) => d.email?.toLowerCase()).filter(Boolean) as string[]),
      ...((supp ?? []).map((d: any) => d.email?.toLowerCase()).filter(Boolean) as string[]),
    ]);

    // Load existing enrollments (any status) for dedup within this sequence
    const { data: existing } = await supabase
      .from("enrollments")
      .select("contact_id, status")
      .eq("user_id", user.id)
      .eq("sequence_id", sequenceId);
    const enrolledSet = new Set((existing ?? []).map((e) => e.contact_id));

    // Cross-sequence dedup: any contact this user has already successfully emailed
    // (or queued an email to) from ANY sequence is skipped by default. The user can
    // opt in to re-contact by passing allow_recontact: true.
    const previouslyContactedSet = new Set<string>();
    if (!allowRecontact) {
      const { data: priorSends } = await supabase
        .from("sent_emails")
        .select("recipient_email")
        .eq("user_id", user.id)
        .in("status", ["sent", "queued"])
        .limit(50000);
      for (const row of priorSends ?? []) {
        if (row.recipient_email) previouslyContactedSet.add(row.recipient_email.toLowerCase());
      }
    }

    let suppressed = 0;
    let alreadyEnrolled = 0;
    let alreadyContacted = 0;
    let noEmail = 0;
    const nowIso = new Date().toISOString();
    const toInsert: Array<Record<string, unknown>> = [];

    for (const c of contacts ?? []) {
      if (!c.email) { noEmail++; continue; }
      const emailLower = c.email.toLowerCase();
      if (dncSet.has(emailLower)) { suppressed++; continue; }
      if (enrolledSet.has(c.id)) { alreadyEnrolled++; continue; }
      if (!allowRecontact && previouslyContactedSet.has(emailLower)) { alreadyContacted++; continue; }
      toInsert.push({
        user_id: user.id,
        sequence_id: sequenceId,
        contact_id: c.id,
        current_step: 0,
        current_node_id: trigger.id, // always a real, currently-existing node
        status: "active",
        next_send_at: nowIso,
      });
    }

    let enrolled = 0;
    if (toInsert.length > 0) {
      const { data: ins, error: insertErr } = await supabase
        .from("enrollments")
        .upsert(toInsert, { onConflict: "sequence_id,contact_id", ignoreDuplicates: true })
        .select("id");
      if (insertErr) throw insertErr;
      enrolled = ins?.length ?? 0;
    }

    // Visibility: if 0 were enrolled, log an activity row so the UI can show
    // "0 enrolled — N skipped because previously contacted" instead of staying silent.
    if (enrolled === 0) {
      await supabase.from("contact_activity").insert({
        user_id: user.id,
        sequence_id: sequenceId,
        contact_id: (contacts ?? [])[0]?.id ?? null,
        activity_type: "enroll_skipped",
        metadata: {
          total_contacts: contacts?.length ?? 0,
          already_contacted: alreadyContacted,
          already_enrolled: alreadyEnrolled,
          suppressed,
          no_email: noEmail,
          allow_recontact: allowRecontact,
        },
      });
    }

    return new Response(
      JSON.stringify({
        enrolled,
        suppressed,
        already_enrolled: alreadyEnrolled,
        already_contacted: alreadyContacted,
        no_email: noEmail,
        total_contacts: contacts?.length ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
