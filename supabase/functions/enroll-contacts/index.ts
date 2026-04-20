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

    const triggers = (allNodes ?? []).filter((n) => n.node_type === "trigger");
    // Prefer a trigger that has an outgoing edge (the "real" wired one)
    const trigger =
      triggers.find((t) => (allEdges ?? []).some((e) => e.source_node_id === t.id)) ??
      triggers[0] ?? null;

    if (!trigger) {
      return new Response(JSON.stringify({ error: "Sequence has no trigger node" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const triggerHasNext = (allEdges ?? []).some((e) => e.source_node_id === trigger.id);
    if (!triggerHasNext) {
      return new Response(JSON.stringify({ error: "Trigger node is not connected to any next step" }), {
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

    // Load existing enrollments (any status) for dedup
    const { data: existing } = await supabase
      .from("enrollments")
      .select("contact_id, status")
      .eq("user_id", user.id)
      .eq("sequence_id", sequenceId);
    const enrolledSet = new Set((existing ?? []).map((e) => e.contact_id));

    let suppressed = 0;
    let alreadyEnrolled = 0;
    let noEmail = 0;
    const nowIso = new Date().toISOString();
    const toInsert: Array<Record<string, unknown>> = [];

    for (const c of contacts ?? []) {
      if (!c.email) { noEmail++; continue; }
      if (dncSet.has(c.email.toLowerCase())) { suppressed++; continue; }
      if (enrolledSet.has(c.id)) { alreadyEnrolled++; continue; }
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

    return new Response(
      JSON.stringify({
        enrolled,
        suppressed,
        already_enrolled: alreadyEnrolled,
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
