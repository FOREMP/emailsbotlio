const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Strip trailing sign-off blocks the model may add — the send function appends its own footer.
function stripSignOff(text: string): string {
  if (!text) return text;
  const pattern = /\n+\s*(Best regards|Kind regards|Sincerely|Cheers|Regards|Vänliga hälsningar|Med vänlig hälsning|Mvh|MVH|Hälsningar|Bästa hälsningar)[\s\S]*$/i;
  return text.replace(pattern, "").replace(/\s+$/, "");
}

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
    const { contact = {}, prompt = "", subject_hint = "", is_followup = false } = body ?? {};

    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const followupHint = is_followup
      ? ` This is a SHORT follow-up to a previous email to the same person. Acknowledge the prior message implicitly (e.g. "circling back", "wanted to follow up"), keep it under 80 words, no greeting line repeating the recipient's name, and end with a single concrete ask.`
      : "";

    const system = `Return ONLY a JSON object: {"subject":"...","body":"..."}. No other text. Do not include any closing signature, sign-off, "Best regards", "Vänliga hälsningar", sender name, or brand line in the body — those are appended automatically.${followupHint}`;

    const referencesVars = /\{\{[\w.]+\}\}/.test(prompt);
    const user = referencesVars
      ? `${prompt}\n\nContact data (for variable substitution):\n${JSON.stringify(contact, null, 2)}${subject_hint ? `\n\nSubject hint: ${subject_hint}` : ""}`
      : `${prompt}${subject_hint ? `\n\nSubject hint: ${subject_hint}` : ""}`;

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

    const cleanBody = stripSignOff(parsed.body ?? "");

    return new Response(JSON.stringify({ subject: parsed.subject ?? "", body: cleanBody }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
