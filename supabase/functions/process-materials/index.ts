import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing server configuration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { simulation_id } = await req.json();
    if (!simulation_id) throw new Error("simulation_id is required");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Update status
    await supabase.from("simulations").update({ status: "processing_materials" }).eq("id", simulation_id);

    // Fetch seed materials
    const { data: materials, error: matErr } = await supabase
      .from("seed_materials")
      .select("*")
      .eq("simulation_id", simulation_id);

    if (matErr) throw matErr;

    // Gather text content from materials
    const textParts: string[] = [];

    for (const mat of materials || []) {
      if (mat.type === "text" && mat.content) {
        textParts.push(`[Text note "${mat.file_name}"]: ${mat.content}`);
      } else if (mat.file_path) {
        // For PDFs and images, download and describe
        const { data: fileData } = await supabase.storage.from("seed-materials").download(mat.file_path);
        if (fileData) {
          if (mat.type === "image") {
            // Convert image to base64 for vision
            const arrayBuffer = await fileData.arrayBuffer();
            const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
            const mimeType = mat.file_name?.endsWith(".png") ? "image/png" : "image/jpeg";

            const visionResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [
                  { role: "system", content: "Describe this image in detail for market research context. Include any text, branding, products, colors, pricing, and any other relevant details." },
                  { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }] },
                ],
              }),
            });
            if (visionResp.ok) {
              const visionData = await visionResp.json();
              const desc = visionData.choices?.[0]?.message?.content || "Image uploaded";
              textParts.push(`[Image "${mat.file_name}"]: ${desc}`);
            }
          } else if (mat.type === "pdf") {
            // Extract text from PDF content
            const text = await fileData.text();
            textParts.push(`[PDF "${mat.file_name}"]: ${text.slice(0, 10000)}`);
          }
        }
      }
    }

    const combinedContent = textParts.join("\n\n---\n\n");

    // Use AI to create a structured summary
    const summaryResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a market research analyst. Given raw product/service materials, create a comprehensive context summary that covers:
1. Product/service description
2. Key features and benefits
3. Target audience indicators
4. Pricing information (if available)
5. Brand positioning
6. Competitive landscape clues
7. Any other relevant market context

Be thorough but concise. This summary will be used to brief thousands of synthetic consumer personas for market simulation.`,
          },
          { role: "user", content: combinedContent || "No materials provided." },
        ],
      }),
    });

    if (!summaryResp.ok) {
      const errText = await summaryResp.text();
      console.error("AI summary error:", summaryResp.status, errText);
      if (summaryResp.status === 429) {
        await supabase.from("simulations").update({ status: "failed" }).eq("id", simulation_id);
        return new Response(JSON.stringify({ error: "Rate limited. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${summaryResp.status}`);
    }

    const summaryData = await summaryResp.json();
    const contextSummary = summaryData.choices?.[0]?.message?.content || "Unable to generate summary.";

    // Store summary and move to next phase
    await supabase.from("simulations").update({
      context_summary: contextSummary,
      status: "generating_agents",
    }).eq("id", simulation_id);

    // Trigger run-simulation
    const runResp = await fetch(`${SUPABASE_URL}/functions/v1/run-simulation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ simulation_id }),
    });

    if (!runResp.ok) {
      console.error("Failed to trigger run-simulation:", await runResp.text());
    }

    return new Response(JSON.stringify({ success: true, context_summary: contextSummary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("process-materials error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
