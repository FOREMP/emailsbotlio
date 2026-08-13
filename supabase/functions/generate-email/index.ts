const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MODEL = "gpt-4o-mini";

// Strip trailing sign-off blocks the model may add — the send function appends its own footer.
function stripSignOff(text: string): string {
  if (!text) return text;
  const pattern = /\n+\s*(Best regards|Kind regards|Sincerely|Cheers|Regards|Vänliga hälsningar|Med vänlig hälsning|Mvh|MVH|Hälsningar|Bästa hälsningar)[\s\S]*$/i;
  return text.replace(pattern, "").replace(/\s+$/, "");
}

// Strip a leading "Subject: ..." line if the model decided to include one in the body.
function stripLeadingSubject(text: string): string {
  if (!text) return text;
  return text.replace(/^\s*subject\s*:\s*[^\n]*\n+/i, "");
}

// Strip surrounding quotes/extra whitespace from a subject the model returns.
function cleanSubjectLine(text: string): string {
  let s = (text ?? "").trim();
  // Remove a leading "Subject:" prefix if present
  s = s.replace(/^\s*subject\s*:\s*/i, "");
  // Take only the first non-empty line
  s = s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? s;
  s = s.trim();
  // Strip wrapping quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

// Replace {{var}} / {{path.to.var}} with values from the contact (including custom_fields).
function interpolate(tpl: string, vars: Record<string, any>): string {
  if (!tpl) return tpl;
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = String(k).split(".").reduce((acc: any, p: string) => (acc == null ? acc : acc[p]), vars);
    return v == null ? "" : String(v);
  });
}

async function callOpenAI(apiKey: string, model: string, system: string, user: string): Promise<string> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.8,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI error (${r.status}): ${t}`);
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? "";
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
    const {
      contact = {},
      prompt = "",                 // body prompt (per node)
      subject_prompt = "",         // dedicated subject prompt (per node)
      subject_hint = "",           // legacy fallback (older nodes)
      is_followup = false,
      model: modelOverride,
    } = body ?? {};

    const bodyPrompt = String(prompt ?? "").trim();
    const subjectPromptRaw = String(subject_prompt ?? "").trim() || String(subject_hint ?? "").trim();

    if (!bodyPrompt) {
      return new Response(JSON.stringify({ error: "prompt (body) is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const model = (typeof modelOverride === "string" && modelOverride.trim()) ? modelOverride.trim() : DEFAULT_MODEL;
    const vars = { ...(contact as Record<string, any>), ...((contact as any)?.custom_fields ?? {}) };

    // Per-node prompts may use {{vars}} — interpolate before sending to the model
    // so the model sees the actual values rather than placeholders.
    const interpolatedBodyPrompt = interpolate(bodyPrompt, vars);
    const interpolatedSubjectPrompt = subjectPromptRaw ? interpolate(subjectPromptRaw, vars) : "";

    const followupClause = is_followup
      ? " This is a SHORT follow-up to a previous email to the same person. Acknowledge the prior message implicitly (e.g. 'circling back', 'wanted to follow up'), keep it under 80 words, and end with a single concrete ask."
      : "";

    // ---- BODY CALL ----
    const bodySystem = `You are writing the BODY of a single email. Follow the user's instructions below EXACTLY.
Return ONLY the email body as plain text.
Do NOT include a subject line. Do NOT include "Subject:".
Do NOT include any closing signature, sign-off, "Best regards", "Vänliga hälsningar", sender name, or company line — those are appended automatically by the system after you respond.${followupClause}`;

    let bodyText = "";
    try {
      const raw = await callOpenAI(apiKey, model, bodySystem, interpolatedBodyPrompt);
      bodyText = stripSignOff(stripLeadingSubject(raw)).trim();
    } catch (e) {
      console.error("[generate-email] body call failed:", (e as Error).message);
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- SUBJECT CALL ----
    let subjectText = "";
    if (interpolatedSubjectPrompt) {
      const subjectSystem = `You are writing ONLY the subject line of a single email. Follow the user's instructions below EXACTLY.
Return ONLY the subject line as plain text — no quotes, no "Subject:" prefix, no extra explanation, no multiple options. Output exactly one line.`;
      try {
        const raw = await callOpenAI(apiKey, model, subjectSystem, interpolatedSubjectPrompt);
        subjectText = cleanSubjectLine(raw);
      } catch (e) {
        console.error("[generate-email] subject call failed:", (e as Error).message);
        // Fall through — we'll fall back below.
      }
    }
    if (!subjectText) {
      // Fallback: derive a short subject from the first line of the body.
      const firstLine = bodyText.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "Hello";
      subjectText = firstLine.slice(0, 80).trim();
    }

    console.log(`[generate-email] model=${model} subject_len=${subjectText.length} body_len=${bodyText.length} followup=${!!is_followup}`);

    return new Response(JSON.stringify({ subject: subjectText, body: bodyText, model }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
