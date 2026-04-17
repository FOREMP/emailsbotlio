const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { contact = {}, prompt = "", subject_hint = "" } = body ?? {};

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contactBlock = JSON.stringify(contact, null, 2);
    const system = `You are an expert cold-outreach copywriter. Always reply in strict JSON: {"subject":"...","body":"..."}. Keep emails concise, personal, and action-oriented. Plain text only.`;
    const user = `Contact data:\n${contactBlock}\n\nWriting brief:\n${prompt}\n\n${subject_hint ? `Subject hint: ${subject_hint}` : ""}\n\nReturn JSON with "subject" and "body".`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `OpenAI error: ${t}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { subject?: string; body?: string } = {};
    try { parsed = JSON.parse(content); } catch { parsed = { subject: subject_hint || "Hello", body: content }; }

    return new Response(JSON.stringify({ subject: parsed.subject ?? "", body: parsed.body ?? "" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
