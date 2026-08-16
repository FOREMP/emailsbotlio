// Approve, regenerate or park generated demo sites for site leads.
// Only leads with status = 'awaiting_approval' block outreach; also shows
// 'generating' and 'failed' so we can see what's in flight.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { ExternalLink, Check, RefreshCw, XCircle, RotateCw, Loader2 } from "lucide-react";

type LeadRow = {
  id: string;
  company_name: string;
  language: string;
  email: string | null;
  website: string | null;
  phone: string | null;
  category: string | null;
  status: string;
  audit_score: number | null;
  audit_reason: string | null;
  audit_details: { weaknesses?: string[] } | null;
  demo_url: string | null;
  generated_site_id: string | null;
  feedback: string | null;
  updated_at: string;
};

const STATUS_BADGE: Record<string, string> = {
  awaiting_approval: "bg-indigo-500",
  generating: "bg-purple-500",
  failed: "bg-red-500",
  approved: "bg-emerald-500",
  needs_site: "bg-amber-500",
};

const CANONICAL_DEMO_HOST = /^demo-[a-z0-9-]+\.vercel\.app$/;

function isCanonicalDemoUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (!CANONICAL_DEMO_HOST.test(url.hostname)) return false;
    if (/-(foremp|[a-z0-9]+s-projects)\.vercel\.app$/.test(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export default function SiteApprovals() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [regen, setRegen] = useState<LeadRow | null>(null);
  const [feedback, setFeedback] = useState("");
  const [regenMode, setRegenMode] = useState<"keep" | "template" | "freeform">("keep");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);
  const [filter, setFilter] = useState<string>("awaiting_approval");
  const [languageFilter, setLanguageFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("site_leads")
        .select("id, company_name, language, email, website, phone, category, status, audit_score, audit_reason, audit_details, demo_url, generated_site_id, feedback, updated_at")
        .in("status", ["awaiting_approval", "generating", "failed", "approved", "site_good_enough", "needs_site"])
        .order("updated_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      setRows((data ?? []) as LeadRow[]);
      setLoading(false);
      return;
    } catch (err) {
      const message = (err as Error).message || "";
      const maybeMissingLanguage = /language/i.test(message) || /column/i.test(message);
      if (!maybeMissingLanguage) {
        toast({ title: "Kunde inte ladda approvals", description: message, variant: "destructive" });
        setRows([]);
        setLoading(false);
        return;
      }
    }

    try {
      const { data, error } = await supabase
        .from("site_leads")
        .select("id, company_name, email, website, phone, category, status, audit_score, audit_reason, audit_details, demo_url, generated_site_id, feedback, updated_at")
        .in("status", ["awaiting_approval", "generating", "failed", "approved", "site_good_enough", "needs_site"])
        .order("updated_at", { ascending: false })
        .limit(400);
      if (error) throw error;
      setRows(((data ?? []) as any[]).map((row) => ({ ...row, language: "sv" })) as LeadRow[]);
      toast({
        title: "Approvals laddade i kompatibilitetsläge",
        description: "Språkfältet saknas eller är inte migrerat fullt i databasen ännu. Svenska leads visas ändå.",
        variant: "destructive",
      });
    } catch (fallbackErr) {
      toast({ title: "Kunde inte ladda approvals", description: (fallbackErr as Error).message, variant: "destructive" });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Poll every 30s so newly-live demos + status changes show up automatically
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const runTick = async () => {
    setTicking(true);
    try {
      const { error } = await supabase.functions.invoke("process-site-leads", { body: {} });
      if (error) throw error;
      toast({ title: "Kör orchestrator", description: "Audit + generering triggad manuellt." });
      await load();
    } catch (e) {
      toast({ title: "Fel", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTicking(false);
    }
  };

  const approve = async (row: LeadRow) => {
    if (!row.email) {
      return toast({ title: "Saknar email", description: "Kan inte enrolla utan email på leaden.", variant: "destructive" });
    }
    if (!row.demo_url) {
      return toast({ title: "Ingen demo", description: "Vänta tills demon är byggd innan godkännande.", variant: "destructive" });
    }
    setBusyId(row.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) throw new Error("Ej inloggad");

      // 1. Look up the Site Demo Outreach sequence + its contact list + trigger node
      const sequenceName = row.language === "en" ? "Site Demo Outreach EN" : "Site Demo Outreach";
      const { data: seq, error: seqErr } = await supabase
        .from("sequences")
        .select("id, contact_list_id")
        .eq("user_id", uid)
        .eq("name", sequenceName)
        .maybeSingle();
      if (seqErr) throw seqErr;
      if (!seq?.id || !seq.contact_list_id) throw new Error(`${sequenceName}-sekvensen saknas — kör seed-migrationen.`);

      const { data: triggerNode } = await supabase
        .from("sequence_nodes")
        .select("id")
        .eq("sequence_id", seq.id)
        .eq("node_type", "trigger")
        .maybeSingle();
      if (!triggerNode?.id) throw new Error("Trigger-nod saknas i Site Demo Outreach.");

      let canonicalDemoUrl = row.demo_url;
      if (row.generated_site_id) {
        const { data: generatedSite, error: siteErr } = await supabase
          .from("generated_sites")
          .select("demo_site_url, vercel_deployment_url, status")
          .eq("id", row.generated_site_id)
          .maybeSingle();
        if (siteErr) throw siteErr;
        canonicalDemoUrl = generatedSite?.demo_site_url ?? canonicalDemoUrl;
      }
      if (!isCanonicalDemoUrl(canonicalDemoUrl)) {
        throw new Error("Demon har ingen stabil publik länk ännu. Kör om deployen innan du godkänner leaden.");
      }

      // 2. Upsert the contact into that list with all site-lead vars in custom_fields
      const emailLower = row.email.toLowerCase().trim();
      const weakness = row.audit_details?.weaknesses?.[0] ?? row.audit_reason ?? "";
      const firstName = emailLower.split("@")[0].split(/[._-]/)[0].replace(/^\w/, (c) => c.toUpperCase());
      const custom_fields = {
        site_lead_id: row.id,
        company_name: row.company_name,
        demo_url: canonicalDemoUrl,
        website: row.website ?? "",
        audit_weakness: weakness,
        audit_score: row.audit_score ?? "",
        category: row.category ?? "",
        language: row.language ?? "sv",
      };

      const { data: existing } = await supabase
        .from("contacts")
        .select("id, custom_fields")
        .eq("user_id", uid)
        .eq("list_id", seq.contact_list_id)
        .eq("email", emailLower)
        .maybeSingle();

      let contactId: string;
      if (existing?.id) {
        const merged = { ...(existing.custom_fields as any ?? {}), ...custom_fields };
        await supabase.from("contacts").update({ custom_fields: merged, first_name: firstName, demo_site_url: canonicalDemoUrl }).eq("id", existing.id);
        contactId = existing.id;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from("contacts")
          .insert({
            user_id: uid,
            list_id: seq.contact_list_id,
            email: emailLower,
            first_name: firstName,
            phone: row.phone,
            demo_site_url: canonicalDemoUrl,
            custom_fields,
            tags: ["site-demo"],
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        contactId = inserted.id;
      }

      // 3. Ensure exactly one active enrollment. If one already exists (approved before)
      //    just re-activate it at the trigger.
      const { data: existingEnr } = await supabase
        .from("enrollments")
        .select("id, status")
        .eq("user_id", uid)
        .eq("sequence_id", seq.id)
        .eq("contact_id", contactId)
        .maybeSingle();
      if (existingEnr?.id) {
        await supabase.from("enrollments").update({
          status: "active",
          current_node_id: triggerNode.id,
          current_step: 0,
          next_send_at: new Date().toISOString(),
          last_error: null,
          error_at: null,
        }).eq("id", existingEnr.id);
      } else {
        const { error: enrErr } = await supabase.from("enrollments").insert({
          user_id: uid,
          sequence_id: seq.id,
          contact_id: contactId,
          status: "active",
          current_node_id: triggerNode.id,
          current_step: 0,
          next_send_at: new Date().toISOString(),
        });
        if (enrErr) throw enrErr;
      }

      // 4. Flip lead status
      await supabase
        .from("site_leads")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", row.id);

      toast({ title: "Godkänd & enrollad", description: `${row.company_name} börjar få mail inom några minuter (${row.language === "en" ? "EN" : "SV"}).` });
      load();
    } catch (e) {
      toast({ title: "Kunde inte godkänna", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };


  const notNeeded = async (row: LeadRow) => {
    if (!confirm(`Markera ${row.company_name} som "behövs ej" och parkera?`)) return;
    setBusyId(row.id);
    const { error } = await supabase
      .from("site_leads")
      .update({ status: "site_good_enough" })
      .eq("id", row.id);
    setBusyId(null);
    if (error) return toast({ title: "Fel", description: error.message, variant: "destructive" });
    toast({ title: "Parkerad" });
    load();
  };

  const submitRegen = async () => {
    if (!regen) return;
    if (!feedback.trim()) {
      toast({ title: "Feedback krävs", description: "Skriv vad som ska ändras innan regenerering.", variant: "destructive" });
      return;
    }
    setBusyId(regen.id);
    try {
      // 1. Save feedback on the lead + flip status back to generating.
      await supabase
        .from("site_leads")
        .update({ status: "generating", feedback: feedback.trim() })
        .eq("id", regen.id);

      // 2. Mirror feedback into the linked ghost contact so process-site-jobs
      //    picks it up in the next generation pass.
      if (regen.generated_site_id) {
        const { data: gs } = await supabase
          .from("generated_sites")
          .select("contact_id")
          .eq("id", regen.generated_site_id)
          .single();
        if (gs?.contact_id) {
          const { data: contact } = await supabase
            .from("contacts")
            .select("custom_fields")
            .eq("id", gs.contact_id)
            .single();
          const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>;
          await supabase
            .from("contacts")
            .update({ custom_fields: { ...cf, regen_feedback: feedback.trim() } })
            .eq("id", gs.contact_id);
        }

        // 3. Re-queue the site so the worker picks it up on the next tick.
        //    Freeform builds page-by-page, so its progress must start clean.
        const modeFields =
          regenMode === "keep"
            ? {}
            : regenMode === "freeform"
              ? { generation_mode: "freeform", gen_progress: null, generated_files: null }
              : { generation_mode: "template" };
        await supabase
          .from("generated_sites")
          .update({
            status: "queued",
            queued_at: new Date().toISOString(),
            error_message: null,
            attempts: 0,
            gen_progress: null,
            generated_files: null,
            ...modeFields,
          })
          .eq("id", regen.generated_site_id);

        await supabase.functions.invoke("process-site-jobs", {
          body: { generated_site_id: regen.generated_site_id },
        });
      } else {
        await supabase.functions.invoke("process-site-leads", {
          body: { force: true, lead_ids: [regen.id] },
        });
      }

      toast({ title: "Regenererar", description: "Ny version byggs, kolla igen om några minuter." });
      setRegen(null);
      setFeedback("");
      setRegenMode("keep");
      load();
    } catch (e) {
      toast({ title: "Fel", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Site Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Godkänn eller ge feedback på autogenererade demo-sajter innan de går ut i email.
          </p>
        </div>
        <Button variant="outline" onClick={runTick} disabled={ticking} className="gap-2">
          {ticking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          Kör orchestrator nu
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: "awaiting_approval", label: "Väntar godkännande" },
          { key: "approved", label: "Godkända" },
          { key: "site_good_enough", label: "Nekade / behövs ej" },
          { key: "generating", label: "Genererar / regenereras" },
          { key: "failed", label: "Misslyckade" },
          { key: "needs_site", label: "Behöver byggas om" },
          { key: "all", label: "Alla" },
        ].map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label} ({f.key === "all" ? rows.length : counts[f.key] ?? 0})
          </Button>
        ))}
        <Button size="sm" variant={languageFilter === "all" ? "default" : "outline"} onClick={() => setLanguageFilter("all")}>
          Alla språk
        </Button>
        <Button size="sm" variant={languageFilter === "sv" ? "default" : "outline"} onClick={() => setLanguageFilter("sv")}>
          Svenska
        </Button>
        <Button size="sm" variant={languageFilter === "en" ? "default" : "outline"} onClick={() => setLanguageFilter("en")}>
          English
        </Button>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Laddar…</div>}

      {!loading && rows.filter((r) => (filter === "all" || r.status === filter) && (languageFilter === "all" || (r.language ?? "sv") === languageFilter)).length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          Inga leads i denna vy just nu.
        </Card>
      )}

      <div className="grid gap-6">
        {rows.filter((r) => (filter === "all" || r.status === filter) && (languageFilter === "all" || (r.language ?? "sv") === languageFilter)).map((row) => (
          <Card key={row.id} className="p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{row.company_name}</h2>
                  <Badge className={STATUS_BADGE[row.status] ?? "bg-slate-500"}>{row.status}</Badge>
                  <Badge variant="outline">{(row.language ?? "sv").toUpperCase()}</Badge>
                  {row.audit_score != null && (
                    <Badge variant="outline">Audit {row.audit_score}/10</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 mt-1">
                  {row.email && <span>{row.email}</span>}
                  {row.phone && <span>{row.phone}</span>}
                  {row.category && <span>{row.category}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.status === "awaiting_approval" && (
                  <>
                    <Button size="sm" onClick={() => approve(row)} disabled={busyId === row.id} className="gap-2">
                      <Check className="h-4 w-4" /> Godkänn
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setRegen(row); setFeedback(row.feedback ?? ""); }} disabled={busyId === row.id} className="gap-2">
                      <RefreshCw className="h-4 w-4" /> Regenerera
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => notNeeded(row)} disabled={busyId === row.id} className="gap-2">
                      <XCircle className="h-4 w-4" /> Behövs ej
                    </Button>
                  </>
                )}
                {row.status === "generating" && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Bygger…
                  </div>
                )}
                {row.status === "failed" && (
                  <Button size="sm" variant="outline" onClick={() => { setRegen(row); setFeedback(row.feedback ?? ""); }} className="gap-2">
                    <RefreshCw className="h-4 w-4" /> Försök igen
                  </Button>
                )}
                {row.status === "needs_site" && (
                  <Button size="sm" variant="outline" onClick={() => { setRegen(row); setFeedback(row.feedback ?? ""); }} className="gap-2">
                    <RefreshCw className="h-4 w-4" /> Bygg om
                  </Button>
                )}
              </div>
            </div>

            {(row.audit_reason || row.audit_details?.weaknesses?.length) && (
              <div className="text-sm bg-muted/50 rounded-md p-3">
                <div className="font-medium mb-1">Audit</div>
                {row.audit_reason && <div className="text-muted-foreground">{row.audit_reason}</div>}
                {row.audit_details?.weaknesses?.length && (
                  <ul className="mt-2 list-disc list-inside text-muted-foreground space-y-0.5">
                    {row.audit_details.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <PreviewFrame title="Nuvarande hemsida" url={row.website} />
              <PreviewFrame title="Ny demo" url={row.demo_url} highlight />
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!regen} onOpenChange={(o) => !o && setRegen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerera hemsida</DialogTitle>
            <DialogDescription>
              Skriv vad AI:n ska ändra i nästa version. T.ex. "ta bort priser", "ändra hero-rubriken till XYZ", "byt färger till mörkgrönt", "tona ner brommbudskapet".
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={6} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Feedback till AI:n…" />
          <div className="space-y-2">
            <div className="text-sm font-medium">Byggmotor för denna regenerering</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={regenMode === "keep" ? "default" : "outline"} onClick={() => setRegenMode("keep")}>
                Samma som förut
              </Button>
              <Button size="sm" variant={regenMode === "template" ? "default" : "outline"} onClick={() => setRegenMode("template")}>
                Mall
              </Button>
              <Button size="sm" variant={regenMode === "freeform" ? "default" : "outline"} onClick={() => setRegenMode("freeform")}>
                AI bygger fritt (DeepSeek V4)
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRegen(null)} disabled={busyId === regen?.id}>Avbryt</Button>
            <Button onClick={submitRegen} disabled={busyId === regen?.id} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Regenerera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreviewFrame({ title, url, highlight }: { title: string; url: string | null; highlight?: boolean }) {
  return (
    <div className={`rounded-md border overflow-hidden ${highlight ? "ring-2 ring-primary/40" : ""}`}>
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 text-xs">
        <span className="font-medium">{title}</span>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
            Öppna <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-muted-foreground">Ingen URL</span>
        )}
      </div>
      {url ? (
        <iframe src={url} title={title} className="w-full h-[480px] bg-white" sandbox="allow-scripts allow-same-origin allow-forms" />
      ) : (
        <div className="h-[480px] flex items-center justify-center text-sm text-muted-foreground">
          {title === "Ny demo" ? "Demo bygger fortfarande…" : "Ingen befintlig hemsida"}
        </div>
      )}
    </div>
  );
}
