import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 25;

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

    // Get simulation details
    const { data: sim, error: simErr } = await supabase
      .from("simulations")
      .select("*")
      .eq("id", simulation_id)
      .single();

    if (simErr || !sim) throw simErr || new Error("Simulation not found");

    const totalAgents = sim.agent_count;
    const context = sim.context_summary || "No context available.";
    const question = sim.question || "What do you think about this product?";

    // Update status to generating_agents
    await supabase.from("simulations").update({ status: "generating_agents" }).eq("id", simulation_id);

    let processedCount = 0;
    const allAgentIds: string[] = [];

    // Generate agents and responses in batches
    const totalBatches = Math.ceil(totalAgents / BATCH_SIZE);

    for (let batch = 0; batch < totalBatches; batch++) {
      const batchCount = Math.min(BATCH_SIZE, totalAgents - processedCount);

      // Update status to running after first batch
      if (batch === 1) {
        await supabase.from("simulations").update({ status: "running" }).eq("id", simulation_id);
      }

      try {
        // Generate personas + responses in one call
        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            tools: [{
              type: "function",
              function: {
                name: "submit_agent_responses",
                description: "Submit simulated consumer agent responses",
                parameters: {
                  type: "object",
                  properties: {
                    agents: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string", description: "Agent name with age, e.g. 'Maria, 28'" },
                          persona: {
                            type: "object",
                            properties: {
                              income: { type: "string", enum: ["low", "medium", "high", "very_high"] },
                              behavior: { type: "string", description: "Primary shopping behavior" },
                              traits: { type: "array", items: { type: "string" }, description: "2-4 personality traits" },
                              goals: { type: "array", items: { type: "string" }, description: "2-3 consumer goals" },
                              age_group: { type: "string", enum: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"] },
                              location_type: { type: "string", enum: ["urban", "suburban", "rural"] },
                            },
                            required: ["income", "behavior", "traits", "goals", "age_group", "location_type"],
                          },
                          response: { type: "string", description: "Their detailed reaction/opinion (2-4 sentences)" },
                          sentiment: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
                        },
                        required: ["name", "persona", "response", "sentiment"],
                      },
                    },
                  },
                  required: ["agents"],
                },
              },
            }],
            tool_choice: { type: "function", function: { name: "submit_agent_responses" } },
            messages: [
              {
                role: "system",
                content: `You are a consumer simulation engine. Generate exactly ${batchCount} unique, diverse synthetic consumer personas and simulate how each would respond to the given question about the product/service described below.

PRODUCT/SERVICE CONTEXT:
${context}

IMPORTANT GUIDELINES:
- Create DIVERSE personas across different demographics (age, income, location, personality)
- Each persona should have a realistic, nuanced reaction — not all positive or all negative
- Responses should feel authentic and varied — different people have different concerns
- Include a mix of sentiments: some enthusiastic, some skeptical, some indifferent
- Personas should reflect real consumer behavior patterns
- Make names diverse (different ethnicities, genders)
- Keep responses concise but insightful (2-4 sentences per agent)`,
              },
              {
                role: "user",
                content: `QUESTION TO EVALUATE:\n${question}\n\nGenerate ${batchCount} diverse consumer personas and their honest reactions.`,
              },
            ],
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          console.error(`Batch ${batch} AI error:`, resp.status, errText);
          if (resp.status === 429) {
            // Wait and retry
            await new Promise(r => setTimeout(r, 5000));
            batch--; // retry this batch
            continue;
          }
          continue; // skip failed batch
        }

        const data = await resp.json();
        const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
        if (!toolCall) {
          console.error(`Batch ${batch}: No tool call in response`);
          continue;
        }

        let agents;
        try {
          agents = JSON.parse(toolCall.function.arguments).agents;
        } catch {
          console.error(`Batch ${batch}: Failed to parse agent data`);
          continue;
        }

        // Insert agents into database
        const agentRows = agents.map((a: any) => ({
          simulation_id,
          name: a.name,
          persona: a.persona,
          response: a.response,
          sentiment: a.sentiment,
        }));

        const { data: inserted, error: insertErr } = await supabase
          .from("agents")
          .insert(agentRows)
          .select("id");

        if (insertErr) {
          console.error(`Batch ${batch} insert error:`, insertErr);
        } else {
          allAgentIds.push(...(inserted || []).map((r: any) => r.id));
        }

        processedCount += batchCount;

        // Update progress
        await supabase.from("simulations").update({
          agents_processed: processedCount,
          status: "running",
        }).eq("id", simulation_id);

        // Small delay between batches to respect rate limits
        if (batch < totalBatches - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (batchErr) {
        console.error(`Batch ${batch} error:`, batchErr);
      }
    }

    // Generate final report
    const { data: allAgents } = await supabase
      .from("agents")
      .select("name, persona, response, sentiment")
      .eq("simulation_id", simulation_id)
      .limit(1000);

    const agentSummaries = (allAgents || []).map((a: any) =>
      `${a.name} (${a.persona?.income} income, ${a.persona?.age_group}, ${a.persona?.location_type}): [${a.sentiment}] ${a.response}`
    ).join("\n");

    const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0 };
    for (const a of allAgents || []) {
      const s = (a as any).sentiment as string;
      if (s in sentimentCounts) sentimentCounts[s as keyof typeof sentimentCounts]++;
    }

    const reportResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a senior market research analyst. Based on the simulation results from ${processedCount} synthetic consumer personas, write a comprehensive market research report.

The report should include:
1. **Executive Summary** (2-3 paragraphs overview)
2. **Key Findings** (bulleted list of 5-8 top insights)
3. **Sentiment Analysis** (breakdown of positive/negative/neutral/mixed with percentages)
4. **Demographic Insights** (how different groups responded differently)
5. **Risk Factors** (potential concerns or barriers identified)
6. **Opportunities** (positive signals and growth areas)
7. **Recommendations** (3-5 actionable recommendations)

Use markdown formatting. Be specific, data-driven, and actionable.`,
          },
          {
            role: "user",
            content: `PRODUCT CONTEXT:\n${context}\n\nQUESTION EVALUATED:\n${question}\n\nSENTIMENT BREAKDOWN:\nPositive: ${sentimentCounts.positive}\nNegative: ${sentimentCounts.negative}\nNeutral: ${sentimentCounts.neutral}\nMixed: ${sentimentCounts.mixed}\n\nAGENT RESPONSES (sample):\n${agentSummaries.slice(0, 8000)}`,
          },
        ],
      }),
    });

    let fullReport = "Report generation failed.";
    let summary = "";

    if (reportResp.ok) {
      const reportData = await reportResp.json();
      fullReport = reportData.choices?.[0]?.message?.content || fullReport;
      // Extract first paragraph as summary
      const lines = fullReport.split("\n").filter((l: string) => l.trim());
      summary = lines.slice(0, 3).join(" ").replace(/[#*]/g, "").trim();
    }

    // Save report
    await supabase.from("reports").insert({
      simulation_id,
      user_id: sim.user_id,
      summary,
      full_report: fullReport,
      insights: {
        total_agents: processedCount,
        sentiment: sentimentCounts,
        sentiment_percentages: {
          positive: Math.round((sentimentCounts.positive / processedCount) * 100) || 0,
          negative: Math.round((sentimentCounts.negative / processedCount) * 100) || 0,
          neutral: Math.round((sentimentCounts.neutral / processedCount) * 100) || 0,
          mixed: Math.round((sentimentCounts.mixed / processedCount) * 100) || 0,
        },
      },
    });

    // Deduct credit
    await supabase.rpc("deduct_credit" as any, { user_id_input: sim.user_id }).catch(() => {
      // If rpc doesn't exist, try manual update
      supabase.from("profiles")
        .update({ credits_remaining: Math.max(0, 2) }) // fallback
        .eq("id", sim.user_id);
    });

    // Mark completed
    await supabase.from("simulations").update({
      status: "completed",
      agents_processed: processedCount,
    }).eq("id", simulation_id);

    return new Response(JSON.stringify({ success: true, agents_created: processedCount }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("run-simulation error:", err);

    // Try to mark as failed
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { simulation_id } = await req.clone().json().catch(() => ({ simulation_id: null }));
      if (simulation_id) {
        await supabase.from("simulations").update({ status: "failed" }).eq("id", simulation_id);
      }
    } catch {}

    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
