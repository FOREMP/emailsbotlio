// The audit is the normal decision point: an operator can park a good site,
// build and send automatically, or explicitly opt into a manual demo review.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { ExternalLink, Check, RefreshCw, XCircle, RotateCw, Loader2, ChevronDown } from "lucide-react";
import { auditScoreLabel } from "@/lib/site-audit-score";

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
  audit_details: { weaknesses?: string[]; recommended_status?: "needs_site" | "site_good_enough" } | null;
  demo_url: string | null;
  generated_site_id: string | null;
  feedback: string | null;
  auto_send: boolean;
  updated_at: string;
};

const STATUS_BADGE: Record<string, string> = {
  awaiting_audit_approval: "bg-sky-600",
  awaiting_approval: "bg-indigo-500",
  generating: "bg-purple-500",
  failed: "bg-red-500",
  approved: "bg-emerald-500",
  auto_approved: "bg-teal-500",
  needs_triage: "bg-orange-500",
  needs_site: "bg-amber-500",
};

const APPROVAL_STATUSES = ["awaiting_audit_approval", "awaiting_approval", "generating", "failed", "approved", "auto_approved", "site_good_enough", "needs_triage", "needs_site"] as const;
const APPROVALS_PAGE_SIZE = 20;
const APPROVALS_REFRESH_MS = 30_000;

function isCanonicalDemoUrl(value?: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".vercel.app") && !url.hostname.endsWith("-foremp.vercel.app");
  } catch {
    return false;
  }
}

export default function SiteApprovals() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [regen, setRegen] = useState<LeadRow | null>(null);
  const [feedback, setFeedback] = useState("");
  const [regenMode, setRegenMode] = useState<"keep" | "template" | "freeform">("keep");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);
  const [filter, setFilter] = useState<string>("awaiting_audit_approval");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  // The lead list is heavy (two iframes per row), so it stays collapsed until
  // asked for. The choice is remembered between visits.
  const [listOpen, setListOpen] = useState(() => {
    try { return localStorage.getItem("approvals-list-open") === "1"; } catch { return false; }
  });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  // A mutation can become visible to the client before a later read reaches
  // the same database snapshot. Remember the old status so a handled card
  // cannot briefly reappear under the operator's cursor.
  const handledStatusRef = useRef(new Map<string, string>());

  const loadCounts = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("get_site_lead_counts", {
      p_language: languageFilter === "all" ? null : languageFilter,
    });
    if (error) throw error;
    const nextCounts: Record<string, number> = {};
    for (const row of data ?? []) {
      if (!APPROVAL_STATUSES.includes(row.status)) continue;
      nextCounts[row.status] = (nextCounts[row.status] ?? 0) + Number(row.count ?? 0);
    }
    setCounts(nextCounts);
  }, [languageFilter]);

  const applyListFilters = useCallback((query: any, includeLanguage: boolean) => {
    let next = query.in("status", [...APPROVAL_STATUSES]);
    if (filter !== "all") next = next.eq("status", filter);
    if (includeLanguage && languageFilter !== "all") next = next.eq("language", languageFilter);
    return next
      // Audits are reviewed FIFO. A second immutable tie-breaker makes the
      // order deterministic even when a batch completes in the same instant.
      // New audit results therefore append instead of jumping above the card
      // currently being reviewed.
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range((page - 1) * APPROVALS_PAGE_SIZE, page * APPROVALS_PAGE_SIZE - 1);
  }, [filter, languageFilter, page]);

  const reconcileRows = useCallback((incoming: LeadRow[], preserveOrder: boolean) => {
    const incomingIds = new Set(incoming.map((row) => row.id));
    for (const id of handledStatusRef.current.keys()) {
      if (!incomingIds.has(id)) handledStatusRef.current.delete(id);
    }

    const available = incoming.filter((row) => {
      const handledStatus = handledStatusRef.current.get(row.id);
      if (!handledStatus) return true;
      if (handledStatus === row.status) return false;
      handledStatusRef.current.delete(row.id);
      return true;
    });

    if (!preserveOrder) {
      setRows(available);
      return;
    }

    // Refresh the data inside existing cards, but keep their visual order.
    // Truly new audits are appended at the bottom of the current page.
    setRows((current) => {
      const byId = new Map(available.map((row) => [row.id, row]));
      const stable = current.flatMap((row) => {
        const updated = byId.get(row.id);
        if (!updated) return [];
        byId.delete(row.id);
        return [updated];
      });
      return [...stable, ...byId.values()];
    });
  }, []);

  const load = useCallback(async ({ silent = false, preserveOrder = true } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data, error, count } = await applyListFilters(
        supabase
          .from("site_leads")
          .select("id, company_name, language, email, website, phone, category, status, audit_score, audit_reason, audit_details, demo_url, generated_site_id, feedback, auto_send, updated_at", { count: "exact" }),
        true,
      );
      if (error) throw error;
      reconcileRows((data ?? []) as LeadRow[], preserveOrder);
      setTotalCount(count ?? 0);
      await loadCounts();
      setLastUpdated(new Date());
      if (!silent) setLoading(false);
      return;
    } catch (err) {
      const message = (err as Error).message || "";
      const maybeMissingLanguage = /language/i.test(message) || /column/i.test(message);
      if (!maybeMissingLanguage) {
        if (!silent) toast({ title: "Kunde inte ladda approvals", description: message, variant: "destructive" });
        if (!silent) setLoading(false);
        return;
      }
    }

    try {
      const { data, error, count } = await applyListFilters(
        supabase
          .from("site_leads")
          .select("id, company_name, email, website, phone, category, status, audit_score, audit_reason, audit_details, demo_url, generated_site_id, feedback, updated_at", { count: "exact" }),
        false,
      );
      if (error) throw error;
      reconcileRows(
        ((data ?? []) as any[]).map((row) => ({ ...row, language: "sv", auto_send: false })) as LeadRow[],
        preserveOrder,
      );
      setTotalCount(count ?? 0);
      await loadCounts();
      setLastUpdated(new Date());
      if (!silent) {
        toast({
          title: "Approvals laddade i kompatibilitetsläge",
          description: "Språkfältet saknas eller är inte migrerat fullt i databasen ännu. Svenska leads visas ändå.",
          variant: "destructive",
        });
      }
    } catch (fallbackErr) {
      if (!silent) {
        toast({ title: "Kunde inte ladda approvals", description: (fallbackErr as Error).message, variant: "destructive" });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyListFilters, loadCounts, reconcileRows]);

  const listKey = `${filter}|${languageFilter}|${page}`;

  const runLoad = useCallback(async ({ silent = false } = {}) => {
    const preserveOrder = loadedKeyRef.current === listKey;
    loadedKeyRef.current = listKey;
    await load({ silent, preserveOrder });
  }, [listKey, load]);

  // When the heavy list is closed, keep only its cheap status counters fresh.
  // An open-list load already refreshes both rows and counters.
  useEffect(() => {
    if (!listOpen) void loadCounts().catch(() => undefined);
  }, [listOpen, loadCounts]);

  // Fetch the visible page when it is opened or its filters change. The
  // background refresh below keeps it current after that first load.
  useEffect(() => {
    if (!listOpen) return;
    if (loadedKeyRef.current === listKey) return;
    void runLoad();
  }, [listKey, listOpen, runLoad]);

  // Keep counts and visible rows fresh without disturbing an active review.
  // Polling is deliberately modest and stops doing list work while collapsed;
  // this avoids adding a noisy Realtime subscription to an already busy DB.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (listOpen) void runLoad({ silent: true });
      else void loadCounts().catch(() => undefined);
    };
    const timer = window.setInterval(refresh, APPROVALS_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [listOpen, loadCounts, runLoad]);

  useEffect(() => {
    try { localStorage.setItem("approvals-list-open", listOpen ? "1" : "0"); } catch { /* ignore */ }
  }, [listOpen]);


  useEffect(() => {
    setPage(1);
  }, [filter, languageFilter]);

  const runTick = async () => {
    setTicking(true);
    try {
      const { error } = await supabase.functions.invoke("process-site-leads", { body: {} });
      if (error) throw error;
      toast({ title: "Kör orchestrator", description: "Audit + generering triggad manuellt." });
      await runLoad();
    } catch (e) {
      toast({ title: "Fel", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTicking(false);
    }
  };

  // A mutation can be committed before a follow-up fetch sees it (and the
  // approval list intentionally caches its expensive iframe rows). Remove the
  // handled lead locally first so the next audit card is immediately usable.
  // The following quiet refresh still reconciles exact totals with the DB.
  const removeHandledRow = (row: LeadRow) => {
    handledStatusRef.current.set(row.id, row.status);
    setRows((current) => current.filter((item) => item.id !== row.id));
    setTotalCount((current) => Math.max(0, current - 1));
    setCounts((current) => ({
      ...current,
      [row.status]: Math.max(0, (current[row.status] ?? 0) - 1),
    }));
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

      removeHandledRow(row);
      toast({ title: "Godkänd & enrollad", description: `${row.company_name} börjar få mail inom några minuter (${row.language === "en" ? "EN" : "SV"}).` });
      void runLoad({ silent: true });
    } catch (e) {
      toast({ title: "Kunde inte godkänna", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };


  const notNeeded = async (row: LeadRow) => {
    setBusyId(row.id);
    const { error } = await supabase
      .from("site_leads")
      .update({ status: "site_good_enough", triaged_at: new Date().toISOString() })
      .eq("id", row.id);
    setBusyId(null);
    if (error) return toast({ title: "Fel", description: error.message, variant: "destructive" });
    removeHandledRow(row);
    toast({ title: "Parkerad" });
    void runLoad({ silent: true });
  };

  const approveAuditForBuild = async (row: LeadRow, autoSend: boolean) => {
    if (autoSend && !row.email) {
      toast({
        title: "Saknar email",
        description: "Välj bygg för granskning eller lägg till en mailadress innan direktutskick.",
        variant: "destructive",
      });
      return;
    }
    setBusyId(row.id);
    try {
      const { data: updated, error: updateError } = await supabase
        .from("site_leads")
        .update({
          status: "needs_site",
          auto_send: autoSend,
          triaged_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("status", "awaiting_audit_approval")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updated) throw new Error("Leaden har redan ändrats. Uppdatera listan och försök igen.");

      // The durable status change is enough to take the lead out of this
      // queue. Do this before the optional immediate worker tick, otherwise a
      // slow/cached reload leaves the same card visible until the browser is
      // refreshed.
      removeHandledRow(row);

      // Use the ordinary bounded queue: this action cannot bypass daily
      // generation limits or concurrency protection.
      const { error: tickError } = await supabase.functions.invoke("process-site-leads", { body: {} });
      if (tickError) {
        toast({
          title: "Köad — byggstarten väntar",
          description: "Leaden är sparad i byggkön och plockas upp automatiskt av nästa orchestrator-körning.",
        });
        void runLoad({ silent: true });
        return;
      }
      toast({
        title: autoSend ? "Köad för bygge och utskick" : "Köad för bygge och granskning",
        description: autoSend
          ? `${row.company_name} skickas automatiskt först när demon har en stabil publik länk.`
          : `${row.company_name} visas för manuell granskning när demon är klar.`,
      });
      void runLoad({ silent: true });
    } catch (e) {
      toast({ title: "Kunde inte köa hemsidan", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const submitRegen = async () => {
    if (!regen) return;
    if (!feedback.trim()) {
      toast({ title: "Feedback krävs", description: "Skriv vad som ska ändras innan regenerering.", variant: "destructive" });
      return;
    }
    setBusyId(regen.id);
    try {
      const feedbackText = feedback.trim();
      let reusedExistingJob = false;

      // 1. Always persist the latest operator feedback first.
      await supabase
        .from("site_leads")
        .update({ feedback: feedbackText, updated_at: new Date().toISOString() })
        .eq("id", regen.id);

      // 2. Mirror feedback into the linked ghost contact so process-site-jobs
      //    picks it up in the next generation pass.
      if (regen.generated_site_id) {
        const { data: gs } = await supabase
          .from("generated_sites")
          .select("id, contact_id")
          .eq("id", regen.generated_site_id)
          .maybeSingle();
        if (gs?.contact_id) {
          const { data: contact } = await supabase
            .from("contacts")
            .select("custom_fields")
            .eq("id", gs.contact_id)
            .single();
          const cf = (contact?.custom_fields ?? {}) as Record<string, unknown>;
          await supabase
            .from("contacts")
            .update({ custom_fields: { ...cf, regen_feedback: feedbackText } })
            .eq("id", gs.contact_id);
        }

        if (gs?.id) {
          // 3a. Re-queue the existing site so the worker picks it up immediately.
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
              ...modeFields,
            })
            .eq("id", gs.id);

          await supabase
            .from("site_leads")
            .update({
              status: "generating",
              generated_site_id: gs.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", regen.id);

          await supabase.functions.invoke("process-site-jobs", { body: { generated_site_id: gs.id } });
          reusedExistingJob = true;
        }
      }

      // 3b. If there is no usable generated-site row anymore, force the lead
      // through the safe backend creation path so a fresh job is created.
      if (!reusedExistingJob) {
        const { error } = await supabase.functions.invoke("process-site-leads", {
          body: { force: true, lead_ids: [regen.id] },
        });
        if (error) throw error;
      }

      toast({
        title: reusedExistingJob ? "Regenererar" : "Ny ombyggnad startad",
        description: reusedExistingJob
          ? "Ny version byggs, kolla igen om några minuter."
          : "En ny byggkö skapades för leaden. Kolla igen om några minuter.",
      });
      setRegen(null);
      setFeedback("");
      setRegenMode("keep");
      await runLoad();
    } catch (e) {
      toast({ title: "Fel", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Site Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Ta beslutet efter audit: parkera, bygg och skicka automatiskt, eller välj en frivillig manuell demo-granskning.
          </p>
        </div>
        <Button variant="outline" onClick={runTick} disabled={ticking} className="gap-2">
          {ticking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          Kör orchestrator nu
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { key: "awaiting_audit_approval", label: "Audit att ta ställning" },
          { key: "awaiting_approval", label: "Manuell demo-granskning" },
          { key: "approved", label: "Godkända" },
          { key: "site_good_enough", label: "Bra nog / auto-parkerade" },
          { key: "generating", label: "Genererar / regenereras" },
          { key: "needs_site", label: "Behöver byggas om" },
          { key: "failed", label: "Misslyckade" },
          { key: "all", label: "Alla" },
        ].map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            onClick={() => { setPage(1); setFilter(f.key); }}
          >
            {f.label} ({f.key === "all" ? Object.values(counts).reduce((sum, value) => sum + value, 0) : counts[f.key] ?? 0})
          </Button>
        ))}
        <Button size="sm" variant={languageFilter === "all" ? "default" : "outline"} onClick={() => { setPage(1); setLanguageFilter("all"); }}>
          Alla språk
        </Button>
        <Button size="sm" variant={languageFilter === "sv" ? "default" : "outline"} onClick={() => { setPage(1); setLanguageFilter("sv"); }}>
          Svenska
        </Button>
        <Button size="sm" variant={languageFilter === "en" ? "default" : "outline"} onClick={() => { setPage(1); setLanguageFilter("en"); }}>
          English
        </Button>
      </div>

      <Collapsible open={listOpen} onOpenChange={setListOpen} className="space-y-4">
        <Card className="p-3 flex flex-wrap items-center gap-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2">
              <ChevronDown className={cn("h-4 w-4 transition-transform", listOpen && "rotate-180")} />
              Leads att granska ({filter === "all"
                ? Object.values(counts).reduce((sum, value) => sum + value, 0)
                : counts[filter] ?? 0})
            </Button>
          </CollapsibleTrigger>
          <span className="text-xs text-muted-foreground">
            {listOpen
              ? lastUpdated
                ? `Uppdateras automatiskt · fast ordning · senast ${lastUpdated.toLocaleTimeString("sv-SE")}`
                : "Uppdateras automatiskt utan att flytta korten"
              : "Klicka för att visa listan"}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-2"
            disabled={loading}
            onClick={() => { setListOpen(true); runLoad(); }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Uppdatera
          </Button>
        </Card>

        <CollapsibleContent className="space-y-6">
      {loading && <div className="text-sm text-muted-foreground">Laddar…</div>}


      {!loading && rows.length === 0 && (
        <Card className="p-8 text-center text-muted-foreground">
          Inga leads i denna vy just nu.
        </Card>
      )}

      <div className="grid gap-6">
        {rows.map((row) => (
          <Card key={row.id} className="p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{row.company_name}</h2>
                  <Badge className={STATUS_BADGE[row.status] ?? "bg-slate-500"}>{row.status}</Badge>
                  {row.status === "auto_approved" && (
                    <Badge variant="outline" className="ml-1 text-[10px]">direkt till utskickskö</Badge>
                  )}
                  {row.status === "awaiting_approval" && row.auto_send && (
                    <Badge variant="outline" className="ml-1 border-amber-500 text-amber-700">
                      Direktutskick väntar på synkning
                    </Badge>
                  )}
                  {row.status === "awaiting_approval" && !row.auto_send && (
                    <Badge variant="outline" className="ml-1 text-[10px]">manuell granskning vald</Badge>
                  )}
                  <Badge variant="outline">{(row.language ?? "sv").toUpperCase()}</Badge>
                  {row.audit_score != null && (
                    <>
                      <Badge className="bg-slate-700">Säljpotential {auditScoreLabel(row.audit_score)}</Badge>
                      <Badge variant="outline">Sajtkvalitet {row.audit_score}/10</Badge>
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 mt-1">
                  {row.email && <span>{row.email}</span>}
                  {row.phone && <span>{row.phone}</span>}
                  {row.category && <span>{row.category}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.status === "awaiting_audit_approval" && (
                  <>
                    <Button size="sm" onClick={() => approveAuditForBuild(row, true)} disabled={busyId === row.id} className="gap-2">
                      <Check className="h-4 w-4" /> Bygg & skicka automatiskt
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => approveAuditForBuild(row, false)} disabled={busyId === row.id} className="gap-2">
                      <RefreshCw className="h-4 w-4" /> Bygg för granskning
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => notNeeded(row)} disabled={busyId === row.id} className="gap-2">
                      <XCircle className="h-4 w-4" /> Ingen hemsida behövs
                    </Button>
                  </>
                )}
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
                {row.audit_details?.recommended_status && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    AI-rekommendation: {row.audit_details.recommended_status === "needs_site" ? "bygg en ny hemsida" : "befintlig hemsida räcker"}.
                  </div>
                )}
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

      <Card className="p-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Sida {page} av {Math.max(1, Math.ceil(totalCount / APPROVALS_PAGE_SIZE))} · Visar {rows.length} av {totalCount}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Föregående
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= Math.max(1, Math.ceil(totalCount / APPROVALS_PAGE_SIZE))}
            onClick={() => setPage((p) => p + 1)}
          >
            Nästa
          </Button>
        </div>
      </Card>
      </CollapsibleContent>
      </Collapsible>


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
