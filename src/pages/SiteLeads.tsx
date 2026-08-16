import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileSpreadsheet, Upload, Pencil, Trash2, Play, Pause, StopCircle, Wand2, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";

type Lead = {
  id: string;
  language: string;
  company_name: string;
  email: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  category: string | null;
  niche: string | null;
  rating: number | null;
  reviews_count: number | null;
  review_snippets: string[] | null;
  feedback: string | null;
  status: string;
  audit_score: number | null;
  demo_url: string | null;
  created_at: string;
};

type ImportRole =
  | "skip"
  | "company_name"
  | "website"
  | "email"
  | "phone"
  | "address"
  | "category"
  | "rating"
  | "reviews_count"
  | "review";

type ParsedData = {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
  fileSize: number;
};

const BATCH_SIZE = 20;

const ROLE_LABELS: Record<ImportRole, string> = {
  skip: "Skippa",
  company_name: "Företag",
  website: "Hemsida",
  email: "Email",
  phone: "Telefon",
  address: "Adress",
  category: "Kategori",
  rating: "Rating",
  reviews_count: "Antal reviews",
  review: "Review-text",
};

const STATUS_OPTIONS = [
  "pending_audit",
  "auditing",
  "site_good_enough",
  "needs_site",
  "generating",
  "awaiting_approval",
  "approved",
  "skipped_no_contact",
  "failed",
];

const STATUS_COLORS: Record<string, string> = {
  pending_audit: "bg-slate-500",
  auditing: "bg-blue-500",
  site_good_enough: "bg-green-500",
  needs_site: "bg-amber-500",
  generating: "bg-purple-500",
  awaiting_approval: "bg-indigo-500",
  approved: "bg-emerald-500",
  skipped_no_contact: "bg-neutral-400",
  failed: "bg-red-500",
};

const NICHE_OPTIONS: { value: string; label: string }[] = [
  { value: "auto_workshop", label: "Bilverkstad / mekaniker" },
  { value: "hair_salon", label: "Frisörsalong" },
  { value: "construction", label: "Byggföretag" },
];

const LANGUAGE_OPTIONS = [
  { value: "sv", label: "Svenska leads" },
  { value: "en", label: "English leads" },
];

export default function SiteLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [uploading, setUploading] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportRole>>({});
  const [niche, setNiche] = useState<string>("");
  const [importLanguage, setImportLanguage] = useState<"sv" | "en">("sv");
  const [progress, setProgress] = useState(0);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [saving, setSaving] = useState(false);

  // Grouping / filtering / sorting
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [nicheFilter, setNicheFilter] = useState<string>("all");
  const [languageFilter, setLanguageFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("created_desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Automation switch + manual override (moved here from the old Sites page)
  const [autoState, setAutoState] = useState<"running" | "paused" | "stopped">("running");
  const [autoBusy, setAutoBusy] = useState(false);
  // Which builder engine new jobs use
  const [genMode, setGenMode] = useState<"template" | "freeform">("template");

  const load = async () => {
    try {
      const { data, error } = await supabase
        .from("site_leads")
        .select("id, company_name, email, website, phone, address, category, niche, rating, reviews_count, review_snippets, feedback, status, audit_score, demo_url, created_at, language")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setLeads((data ?? []) as Lead[]);
      setSelected(new Set());
      const c: Record<string, number> = {};
      for (const l of data ?? []) c[l.status] = (c[l.status] ?? 0) + 1;
      setCounts(c);
      return;
    } catch (err) {
      const message = (err as Error).message || "";
      const maybeMissingLanguage = /language/i.test(message) || /column/i.test(message);
      if (!maybeMissingLanguage) {
        toast({ title: "Kunde inte ladda leads", description: message, variant: "destructive" });
        setLeads([]);
        setCounts({});
        return;
      }
    }

    try {
      const { data, error } = await supabase
        .from("site_leads")
        .select("id, company_name, email, website, phone, address, category, niche, rating, reviews_count, review_snippets, feedback, status, audit_score, demo_url, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map((row) => ({ ...row, language: "sv" })) as Lead[];
      setLeads(rows);
      setSelected(new Set());
      const c: Record<string, number> = {};
      for (const l of rows) c[l.status] = (c[l.status] ?? 0) + 1;
      setCounts(c);
      toast({
        title: "Leads laddade i kompatibilitetsläge",
        description: "Språkfältet saknas eller är inte migrerat fullt i databasen ännu. Svenska leads visas ändå.",
        variant: "destructive",
      });
    } catch (fallbackErr) {
      toast({ title: "Kunde inte ladda leads", description: (fallbackErr as Error).message, variant: "destructive" });
      setLeads([]);
      setCounts({});
    }
  };

  const loadAutoState = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_generation_state")
      .maybeSingle();
    setAutoState(((data?.value as any)?.state ?? "running") as "running" | "paused" | "stopped");
  };

  const loadGenMode = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "site_generation_mode")
      .maybeSingle();
    setGenMode(((data?.value as any)?.mode ?? "template") as "template" | "freeform");
  };

  const changeGenMode = async (mode: "template" | "freeform") => {
    setAutoBusy(true);
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "site_generation_mode", value: { mode } as any, updated_at: new Date().toISOString() });
      if (error) throw error;
      setGenMode(mode);
      toast({
        title: mode === "freeform" ? "Byggmotor: AI bygger fritt" : "Byggmotor: Mall",
        description: mode === "freeform"
          ? "Nya hemsidor byggs från grunden av DeepSeek V4 Flash."
          : "Nya hemsidor byggs med de befintliga mallarna.",
      });
    } catch (err) {
      toast({ title: "Kunde inte byta byggmotor", description: (err as Error).message, variant: "destructive" });
    } finally {
      setAutoBusy(false);
    }
  };



  const changeAutoState = async (state: "running" | "paused" | "stopped") => {
    setAutoBusy(true);
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "site_generation_state", value: { state } as any, updated_at: new Date().toISOString() });
      if (error) throw error;
      setAutoState(state);
      toast({ title: `Automation: ${state === "running" ? "Igång" : state === "paused" ? "Pausad" : "Stoppad"}` });
    } catch (err) {
      toast({ title: "Kunde inte ändra automation", description: (err as Error).message, variant: "destructive" });
    } finally {
      setAutoBusy(false);
    }
  };

  const runPipelineNow = async () => {
    setAutoBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-site-leads", { body: {} });
      if (error) throw error;
      toast({ title: "Pipeline körd", description: `Auditerade ${data?.audited ?? 0}, startade ${data?.generated ?? 0} bygg.` });
      await load();
    } catch (err) {
      toast({ title: "Pipeline misslyckades", description: (err as Error).message, variant: "destructive" });
    } finally {
      setAutoBusy(false);
    }
  };

  const forceBuildSelected = async () => {
    const ids = Array.from(selected).slice(0, 20);
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-site-leads", {
        body: { force: true, lead_ids: ids },
      });
      if (error) throw error;
      toast({
        title: `Bygger ${data?.generated ?? 0} hemsida(or) nu`,
        description: data?.errors?.length ? String(data.errors[0]) : "Override — ignorerar dagsgräns och pausläge.",
      });
      await load();
    } catch (err) {
      toast({ title: "Kunde inte starta bygge", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };

  useEffect(() => { load(); loadAutoState(); loadGenMode(); }, []);


  const visible = leads
    .filter((l) => (statusFilter === "all" ? true : l.status === statusFilter))
    .filter((l) => (nicheFilter === "all" ? true : (l.niche ?? "") === nicheFilter))
    .filter((l) => (languageFilter === "all" ? true : (l.language ?? "sv") === languageFilter))
    .filter((l) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [l.company_name, l.email, l.website, l.category, l.address]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "created_asc": return a.created_at.localeCompare(b.created_at);
        case "company": return a.company_name.localeCompare(b.company_name, "sv");
        case "audit_asc": return (a.audit_score ?? 99) - (b.audit_score ?? 99);
        case "audit_desc": return (b.audit_score ?? -1) - (a.audit_score ?? -1);
        case "status": return a.status.localeCompare(b.status);
        default: return b.created_at.localeCompare(a.created_at);
      }
    });

  const allVisibleSelected = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((l) => next.delete(l.id));
      else visible.forEach((l) => next.add(l.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(`Radera ${ids.length} leads? Detta går inte att ångra.`)) return;
    setBulkBusy(true);
    try {
      const { error } = await supabase.from("site_leads").delete().in("id", ids);
      if (error) throw error;
      toast({ title: `${ids.length} leads raderade` });
      await load();
    } catch (err) {
      toast({ title: "Kunde inte radera", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSet = async (patch: Record<string, unknown>, label: string) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const { error } = await supabase.from("site_leads").update(patch as any).in("id", ids);
      if (error) throw error;
      toast({ title: `${ids.length} leads uppdaterade`, description: label });
      await load();
    } catch (err) {
      toast({ title: "Kunde inte uppdatera", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBulkBusy(false);
    }
  };


  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = await parseFile(f);
      setParsed(data);
      setMapping(autoDetectMapping(data.headers));
    } catch (err) {
      toast({ title: "Kunde inte läsa filen", description: (err as Error).message, variant: "destructive" });
      e.target.value = "";
    }
  };

  const startImport = async () => {
    if (!parsed) return;
    if (!Object.values(mapping).includes("company_name")) {
      toast({ title: "Välj företagskolumn", description: "Mappa en kolumn till Företag innan import.", variant: "destructive" });
      return;
    }

    setUploading(true);
    setProgress(0);
    const totals = { inserted: 0, duplicates: 0, invalid: 0, skipped_no_contact: 0, failed_batches: 0, total: 0 };
    const batchErrors: string[] = [];
    try {
      for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
        const rows = parsed.rows.slice(i, i + BATCH_SIZE).map((row) => slimRow(row, mapping));
        const { data, error } = await supabase.functions.invoke("import-site-leads", {
          body: { rows, mapping, language: importLanguage, ...(niche ? { niche } : {}) },
        });
        if (error) {
          totals.failed_batches += 1;
          batchErrors.push(error.message);
        } else {
          if ((data as any)?.error) {
            totals.failed_batches += 1;
            batchErrors.push(String((data as any).error));
          }
          totals.inserted += data?.inserted ?? 0;
          totals.duplicates += data?.duplicates ?? 0;
          totals.invalid += data?.invalid ?? 0;
          totals.skipped_no_contact += data?.skipped_no_contact ?? 0;
          totals.total += data?.total ?? 0;
        }
        setProgress(Math.min(parsed.rows.length, i + BATCH_SIZE));
      }

      toast({
        title: "Import klar",
        description: `${totals.inserted} nya, ${totals.duplicates} dubbletter, ${totals.skipped_no_contact} utan både email + hemsida.${totals.failed_batches ? ` ${totals.failed_batches} batchar misslyckades.` : ""}`,
      });
      if (batchErrors.length) {
        toast({
          title: "Importfel hittades",
          description: batchErrors[0],
          variant: "destructive",
        });
      }
      setParsed(null);
      setProgress(0);
      await load();
    } catch (err) {
      toast({ title: "Import misslyckades", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const website = normalizeUrl(editing.website);
      const email = normalizeEmail(editing.email);
      const domain = extractDomain(website) || (email ? email.split("@")[1] : null);
      const snippets = (editing.review_snippets ?? [])
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
        .slice(0, 5);

      // Auto-adjust status only when it's a contact-driven bucket.
      let status = editing.status;
      const hasContact = !!website && !!email;
      if (status === "skipped_no_contact" && hasContact) status = "pending_audit";
      if (status === "pending_audit" && !hasContact) status = "skipped_no_contact";

      const { error } = await supabase
        .from("site_leads")
        .update({
          company_name: editing.company_name.trim(),
          company_name_normalized: normalizeName(editing.company_name),
          website,
          email,
          domain,
          domain_normalized: domain ? domain.toLowerCase() : null,
          phone: editing.phone || null,
          address: editing.address || null,
          category: editing.category || null,
          rating: editing.rating,
          reviews_count: editing.reviews_count,
          review_snippets: snippets.length ? snippets : null,
          feedback: editing.feedback || null,
          niche: editing.niche || "auto_workshop",
          language: editing.language || "sv",
          status,
        })
        .eq("id", editing.id);
      if (error) throw error;
      toast({ title: "Sparat", description: `${editing.company_name} uppdaterad.` });
      setEditing(null);
      await load();
    } catch (err) {
      toast({ title: "Kunde inte spara", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteLead = async () => {
    if (!editing) return;
    if (!confirm(`Radera ${editing.company_name}? Detta går inte att ångra.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("site_leads").delete().eq("id", editing.id);
      if (error) throw error;
      toast({ title: "Raderad" });
      setEditing(null);
      await load();
    } catch (err) {
      toast({ title: "Kunde inte radera", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Site Leads</h1>
          <p className="text-sm text-muted-foreground">
            Ladda upp Google-skrapade CSV-listor. Deepseek normaliserar och dedupar automatiskt.
          </p>
        </div>
        <label className="inline-block">
          <Input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} disabled={uploading} className="hidden" />
          <Button asChild disabled={uploading}>
            <span className="gap-2 inline-flex items-center"><Upload className="h-4 w-4" /> Ladda upp fil</span>
          </Button>
        </label>
      </div>

      {parsed && (
        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{parsed.fileName}</span>
            <span className="text-muted-foreground">— {parsed.rows.length} rader, {parsed.headers.length} kolumner</span>
            {uploading && <span className="text-muted-foreground">Importerar {progress}/{parsed.rows.length}</span>}
            <Button variant="ghost" size="sm" className="ml-auto" disabled={uploading} onClick={() => setParsed(null)}>Avbryt</Button>
          </div>

          <div className="grid gap-1 max-w-sm">
            <Label className="text-xs uppercase text-muted-foreground">Språk för denna fil</Label>
            <Select value={importLanguage} onValueChange={(v: "sv" | "en") => setImportLanguage(v)} disabled={uploading}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Detta styr språk för approvals, outreach och hemsidetext för hela batchen.
            </p>
          </div>

          <div className="grid gap-1 max-w-sm">
            <Label className="text-xs uppercase text-muted-foreground">Bransch / mall (valfritt)</Label>
            <Select value={niche || "auto"} onValueChange={(v) => setNiche(v === "auto" ? "" : v)} disabled={uploading}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto — från kategori-kolumnen</SelectItem>
                {NICHE_OPTIONS.map((n) => (
                  <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Branschen läses automatiskt från kolumnen du mappar till Kategori. Finns ingen mall för kategorin byggs hemsidan med AI-motorn (freeform).
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {parsed.headers.map((header) => (
              <div key={header} className="grid gap-1">
                <Label className="text-xs font-mono truncate" title={header}>{header}</Label>
                <Select
                  value={mapping[header] ?? "skip"}
                  onValueChange={(value) => setMapping((prev) => ({ ...prev, [header]: value as ImportRole }))}
                  disabled={uploading}
                >
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as ImportRole[]).map((role) => (
                      <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={uploading} onClick={() => setMapping(autoDetectMapping(parsed.headers))}>Auto-mappa</Button>
            <Button disabled={uploading} onClick={startImport}>{uploading ? "Importerar..." : `Importera ${parsed.rows.length} leads`}</Button>
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Hemsidegenerering</div>
            <p className="text-xs text-muted-foreground">
              Styr om systemet automatiskt får bygga nya hemsidor. Pågående jobb slutförs alltid.
            </p>
          </div>
          <Badge className={
            autoState === "running" ? "bg-emerald-500" : autoState === "paused" ? "bg-amber-500" : "bg-red-500"
          }>
            {autoState === "running" ? "Igång" : autoState === "paused" ? "Pausad" : "Stoppad"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={autoState === "running" ? "default" : "outline"} className="gap-1"
            disabled={autoBusy || autoState === "running"} onClick={() => changeAutoState("running")}>
            <Play className="h-4 w-4" /> Starta
          </Button>
          <Button size="sm" variant={autoState === "paused" ? "default" : "outline"} className="gap-1"
            disabled={autoBusy || autoState === "paused"} onClick={() => changeAutoState("paused")}>
            <Pause className="h-4 w-4" /> Pausa
          </Button>
          <Button size="sm" variant={autoState === "stopped" ? "destructive" : "outline"} className="gap-1"
            disabled={autoBusy || autoState === "stopped"} onClick={() => changeAutoState("stopped")}>
            <StopCircle className="h-4 w-4" /> Stoppa
          </Button>
          <Button size="sm" variant="secondary" className="gap-1 ml-auto" disabled={autoBusy} onClick={runPipelineNow}>
            <RefreshCw className="h-4 w-4" /> Kör pipeline nu
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <div className="text-sm font-medium">Byggmotor</div>
          <Button size="sm" variant={genMode === "template" ? "default" : "outline"}
            disabled={autoBusy || genMode === "template"} onClick={() => changeGenMode("template")}>
            Mall (nuvarande)
          </Button>
          <Button size="sm" variant={genMode === "freeform" ? "default" : "outline"}
            disabled={autoBusy || genMode === "freeform"} onClick={() => changeGenMode("freeform")}>
            AI bygger fritt (DeepSeek V4)
          </Button>
          <p className="text-xs text-muted-foreground basis-full">
            Gäller nya bygg. Den moderna byggaren använder nu alltid de nyare mallfamiljerna och bygger fler sidor när underlaget räcker,
            i stället för att falla tillbaka till den äldre enklare 3-sidorsmotorn.
          </p>
        </div>
      </Card>



      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(counts).map(([k, v]) => (
          <Card key={k} className="p-4">
            <div className="text-xs uppercase text-muted-foreground">{k}</div>
            <div className="text-2xl font-bold">{v}</div>
          </Card>
        ))}
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök företag, email, hemsida…"
          className="h-9 w-full sm:w-64"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla statusar</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s}{counts[s] ? ` (${counts[s]})` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={nicheFilter} onValueChange={setNicheFilter}>
          <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Bransch" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla branscher</SelectItem>
            {NICHE_OPTIONS.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={languageFilter} onValueChange={setLanguageFilter}>
          <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Språk" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alla språk</SelectItem>
            {LANGUAGE_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-9 w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created_desc">Nyast först</SelectItem>
            <SelectItem value="created_asc">Äldst först</SelectItem>
            <SelectItem value="company">Företag A–Ö</SelectItem>
            <SelectItem value="audit_asc">Sämst audit först</SelectItem>
            <SelectItem value="audit_desc">Bäst audit först</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{visible.length} av {leads.length} leads</span>
      </Card>

      {selected.size > 0 && (
        <Card className="p-3 flex flex-wrap items-center gap-2 border-primary/40">
          <span className="text-sm font-medium">{selected.size} valda</span>
          <Button size="sm" variant="outline" disabled={bulkBusy}
            onClick={() => bulkSet({ status: "needs_site" }, "Köade för hemsidebygge")}>
            Köa för hemsida
          </Button>
          <Button size="sm" variant="default" className="gap-1" disabled={bulkBusy} onClick={forceBuildSelected}>
            <Wand2 className="h-4 w-4" /> Bygg nu (override)
          </Button>

          <Button size="sm" variant="outline" disabled={bulkBusy}
            onClick={() => bulkSet({ status: "pending_audit" }, "Skickade till ny audit")}>
            Kör audit igen
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy}
            onClick={() => bulkSet({ status: "site_good_enough" }, "Uteslutna från bygget")}>
            Ta bort från byggkön
          </Button>
          <Select disabled={bulkBusy} onValueChange={(v) => bulkSet({ niche: v }, "Bransch uppdaterad")}>
            <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Byt bransch…" /></SelectTrigger>
            <SelectContent>
              {NICHE_OPTIONS.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={bulkDelete} className="gap-1">
            <Trash2 className="h-4 w-4" /> Radera
          </Button>
          <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={() => setSelected(new Set())}>Avmarkera</Button>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 w-8">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Markera alla" />
              </th>
              <th className="text-left p-3">Företag</th>
              <th className="text-left p-3">Bransch</th>
              <th className="text-left p-3">Språk</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Website</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Audit</th>
              <th className="text-left p-3">Demo</th>
              <th className="text-right p-3"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-3">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleOne(l.id)} aria-label={`Välj ${l.company_name}`} />
                </td>
                <td className="p-3 font-medium">{l.company_name}</td>
                <td className="p-3 text-muted-foreground text-xs">
                  {NICHE_OPTIONS.find((n) => n.value === l.niche)?.label ?? l.niche ?? "—"}
                </td>
                <td className="p-3">
                  <Badge variant="outline">{(l.language ?? "sv").toUpperCase()}</Badge>
                </td>
                <td className="p-3 text-muted-foreground">{l.email ?? "—"}</td>
                <td className="p-3 text-muted-foreground truncate max-w-[200px]">
                  {l.website ? <a href={l.website} target="_blank" rel="noreferrer" className="underline">{l.website}</a> : "—"}
                </td>
                <td className="p-3">
                  <Badge className={STATUS_COLORS[l.status] ?? "bg-slate-400"}>{l.status}</Badge>
                </td>
                <td className="p-3">{l.audit_score ?? "—"}</td>
                <td className="p-3">
                  {l.demo_url ? <a href={l.demo_url} target="_blank" rel="noreferrer" className="underline">Öppna</a> : "—"}
                </td>
                <td className="p-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ ...l, review_snippets: l.review_snippets ?? [] })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">
                {leads.length === 0 ? "Inga leads än. Ladda upp en CSV för att börja." : "Inga leads matchar filtret."}
              </td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Redigera lead</DialogTitle>
            <DialogDescription>Uppdatera all info om företaget. Status justeras automatiskt om email/hemsida saknas.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4">
              <Field label="Företag">
                <Input value={editing.company_name} onChange={(e) => setEditing({ ...editing, company_name: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email"><Input value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
                <Field label="Hemsida"><Input value={editing.website ?? ""} onChange={(e) => setEditing({ ...editing, website: e.target.value })} /></Field>
                <Field label="Telefon"><Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
                <Field label="Kategori"><Input value={editing.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
                <Field label="Rating"><Input type="number" step="0.1" value={editing.rating ?? ""} onChange={(e) => setEditing({ ...editing, rating: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
                <Field label="Antal reviews"><Input type="number" value={editing.reviews_count ?? ""} onChange={(e) => setEditing({ ...editing, reviews_count: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              </div>
              <Field label="Adress"><Input value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></Field>
              <Field label="Reviews (en per rad, max 5)">
                <Textarea rows={5} value={(editing.review_snippets ?? []).join("\n")} onChange={(e) => setEditing({ ...editing, review_snippets: e.target.value.split("\n") })} />
              </Field>
              <Field label="Feedback / interna anteckningar">
                <Textarea rows={3} value={editing.feedback ?? ""} onChange={(e) => setEditing({ ...editing, feedback: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bransch / mall">
                  <Select value={editing.niche ?? ""} onValueChange={(v) => setEditing({ ...editing, niche: v })}>
                    <SelectTrigger><SelectValue placeholder="Välj bransch…" /></SelectTrigger>
                    <SelectContent>
                      {NICHE_OPTIONS.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Språk">
                  <Select value={editing.language ?? "sv"} onValueChange={(v) => setEditing({ ...editing, language: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGE_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          )}
          <DialogFooter className="flex sm:justify-between gap-2">
            <Button variant="destructive" onClick={deleteLead} disabled={saving} className="gap-2">
              <Trash2 className="h-4 w-4" /> Radera
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Avbryt</Button>
              <Button onClick={saveEdit} disabled={saving}>{saving ? "Sparar..." : "Spara"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function autoDetectMapping(headers: string[]): Record<string, ImportRole> {
  const mapping: Record<string, ImportRole> = {};
  const used = new Set<ImportRole>();
  for (const header of headers) {
    const h = header.toLowerCase().trim();
    const once = (role: ImportRole) => {
      if (used.has(role)) return false;
      mapping[header] = role;
      used.add(role);
      return true;
    };

    if (/lat|lng|lon|coord|plus_code|place_id|cid|kml|fid|panorama|image|photo|thumb|logo|icon|hour|open|close|time|schedule/i.test(h)) mapping[header] = "skip";
    else if (/^(name|title)$|company|business|företag|firma/i.test(h) && once("company_name")) continue;
    else if (/email|e-mail|mail/i.test(h) && once("email")) continue;
    else if (/website|web site|site|domain|homepage|url|hemsida|webb/i.test(h) && once("website")) continue;
    else if (/phone|tel|mobile|telefon/i.test(h) && once("phone")) continue;
    else if (/address|street|city|postal|zip|region|country|adress/i.test(h) && once("address")) continue;
    else if (/category|type|industry|kategori/i.test(h) && once("category")) continue;
    else if (/reviews?_count|review.*number|number.*review|antal.*review/i.test(h) && once("reviews_count")) continue;
    else if (/rating|score|stars|betyg/i.test(h) && once("rating")) continue;
    else if (/review|recension|comment|feedback/i.test(h)) mapping[header] = "review";
    else mapping[header] = "skip";
  }
  return mapping;
}

function slimRow(row: Record<string, string>, mapping: Record<string, ImportRole>) {
  const out: Record<string, string> = {};
  for (const [header, role] of Object.entries(mapping)) {
    if (role === "skip") continue;
    const max = role === "review" ? 900 : 220;
    out[header] = (row[header] ?? "").slice(0, max);
  }
  return out;
}

function parseFile(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (json.length === 0) throw new Error("Filen är tom.");
        const headerSet = new Set<string>();
        json.forEach((row) => Object.keys(row).forEach((key) => headerSet.add(key)));
        const headers = Array.from(headerSet);
        const rows = json.map((row) => {
          const mapped: Record<string, string> = {};
          headers.forEach((h) => { mapped[h] = String(row[h] ?? ""); });
          return mapped;
        });
        resolve({ headers, rows, fileName: file.name, fileSize: file.size });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Kunde inte läsa filen."));
      }
    };
    reader.onerror = () => reject(new Error("Kunde inte läsa filen."));
    reader.readAsArrayBuffer(file);
  });
}

function normalizeEmail(v?: string | null): string | null {
  if (!v) return null;
  const m = v.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function normalizeUrl(v?: string | null): string | null {
  if (!v) return null;
  const first = v.trim().split(/[\s,]+/).find((x) => /[\w-]+\.[a-z]{2,}/i.test(x)) ?? v.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(first) ? first : `https://${first}`);
    u.hash = ""; u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}

function extractDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]+/gu, "").trim();
}
