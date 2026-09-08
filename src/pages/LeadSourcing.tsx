import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned, Loader2, Play, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type Language = "sv" | "en";
type Market = { id: string; language: Language; country_code: string; city: string; category: string; niche_key: string | null; search_query: string; is_enabled: boolean; priority: number; max_results: number; cooldown_days: number; last_scraped_at: string | null };
type Job = { id: string; language: Language; search_query: string; state: string; max_results: number; discovered_count: number; imported_count: number; duplicate_count: number; rejected_count: number; error_message: string | null; created_at: string };
type Settings = { state?: "manual" | "auto" | "paused"; buffer_days?: number; lead_stock_multiplier?: number; stock_tolerance?: number; backlog_multiplier?: number };
type HistoryRow = { id: string; language: Language; city: string; niche_key: string; search_query: string | null; source: "legacy_local" | "server"; source_note: string | null; completed_at: string };
type SourcingCoverage = { language: Language; daily_capacity: number; stock: number; target: number; tolerance: number; audit_backlog: number; review_backlog: number; build_backlog: number; backlog_cap: number; should_source: boolean; reason: string };
type SourcingStatus = { coverage: SourcingCoverage[]; active_job: { language: Language; search_query: string; state: string } | null; next_market: { language: Language; category: string; city: string } | null };

const db = supabase as any;
const MARKET_PAGE_SIZE = 50;

const stateColour: Record<string, string> = { completed: "bg-emerald-500", failed: "bg-red-600", running: "bg-blue-500", importing: "bg-blue-500", dispatched: "bg-amber-500", queued: "bg-amber-500" };

export default function LeadSourcing() {
  const { user } = useAuth();
  const [language, setLanguage] = useState<"all" | Language>("all");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketTotal, setMarketTotal] = useState(0);
  const [marketPage, setMarketPage] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<Settings>({ state: "manual", buffer_days: 3 });
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [sourcingStatus, setSourcingStatus] = useState<SourcingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<Language | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [matrixLanguage, setMatrixLanguage] = useState<Language>("sv");
  const [citiesInput, setCitiesInput] = useState("");
  const [nichesInput, setNichesInput] = useState("Hair salon");
  const [addingMatrix, setAddingMatrix] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let marketQuery = db.from("lead_markets").select("*", { count: "exact" }).eq("user_id", user.id).order("priority").order("city");
    if (language !== "all") marketQuery = marketQuery.eq("language", language);
    marketQuery = marketQuery.range(marketPage * MARKET_PAGE_SIZE, marketPage * MARKET_PAGE_SIZE + MARKET_PAGE_SIZE - 1);
    const [{ data: existing, error: marketError, count: marketCount }, { data: settingRow }, { data: historyRows, error: historyError }, { data: statusData }] = await Promise.all([
      marketQuery,
      db.from("app_settings").select("value").eq("key", "lead_sourcing_state").maybeSingle(),
      db.from("lead_scrape_history").select("*").eq("user_id", user.id).order("completed_at", { ascending: false }).limit(100),
      supabase.functions.invoke("lead-sourcing", { body: { action: "status" } }),
    ]);
    if (marketError) {
      toast({ title: "Lead sourcing är inte installerat ännu", description: marketError.message, variant: "destructive" });
      setLoading(false); return;
    }
    const currentMarkets = (existing ?? []) as Market[];
    const { data: jobRows, error: jobError } = await db.from("lead_scrape_jobs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    if (jobError) toast({ title: "Kunde inte ladda sourcing-jobb", description: jobError.message, variant: "destructive" });
    setMarkets(currentMarkets);
    setMarketTotal(marketCount ?? 0);
    setJobs((jobRows ?? []) as Job[]);
    setSettings((settingRow?.value ?? { state: "manual", lead_stock_multiplier: 4, stock_tolerance: 5, backlog_multiplier: 2 }) as Settings);
    if (!historyError) setHistory((historyRows ?? []) as HistoryRow[]);
    if (statusData?.ok) setSourcingStatus(statusData as SourcingStatus);
    setLoading(false);
  }, [user, language, marketPage]);

  useEffect(() => { void load(); }, [load]);

  const shownMarkets = markets;
  const shownJobs = useMemo(() => language === "all" ? jobs : jobs.filter((job) => job.language === language), [language, jobs]);

  async function changeState(next: Settings["state"]) {
    const value = { ...settings, state: next };
    const { error } = await db.from("app_settings").upsert({ key: "lead_sourcing_state", value, updated_at: new Date().toISOString() });
    if (error) return toast({ title: "Kunde inte spara", description: error.message, variant: "destructive" });
    setSettings(value);
  }
  async function runNow(runLanguage: Language) {
    setRunning(runLanguage);
    const { data, error } = await supabase.functions.invoke("lead-sourcing", { body: { action: "run_now", language: runLanguage } });
    setRunning(null);
    if (error || !data?.ok) return toast({ title: "Kunde inte köa sökning", description: error?.message ?? data?.error ?? data?.reason, variant: "destructive" });
    toast({ title: data.dispatched ? "Sökning köad" : "Ingen sökning startades", description: data.dispatched ? "Lead-servern hämtar nu företag i bakgrunden." : data.reason });
    await load();
  }
  async function addMatrix() {
    const cities = citiesInput.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
    const niches = nichesInput.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
    if (!cities.length || !niches.length) return toast({ title: "Lägg till plats och nisch", description: "Skriv minst en plats och en nisch.", variant: "destructive" });
    setAddingMatrix(true);
    const { data, error } = await supabase.functions.invoke("lead-sourcing", { body: { action: "add_matrix", language: matrixLanguage, cities, niches } });
    setAddingMatrix(false);
    if (error || !data?.ok) return toast({ title: "Kunde inte skapa sökplanen", description: error?.message ?? data?.error, variant: "destructive" });
    toast({ title: "Sökplan sparad", description: `${data.combinations} kombinationer. ${data.already_covered ?? 0} var redan skrapade och hålls avstängda.` });
    setCitiesInput("");
    await load();
  }
  async function toggleMarket(market: Market, enabled: boolean) {
    const { error } = await db.from("lead_markets").update({ is_enabled: enabled }).eq("id", market.id);
    if (error) return toast({ title: "Kunde inte ändra marknad", description: error.message, variant: "destructive" });
    setMarkets((old) => old.map((item) => item.id === market.id ? { ...item, is_enabled: enabled } : item));
  }
  async function cancelJob(job: Job) {
    setCancelling(job.id);
    const { data, error } = await supabase.functions.invoke("lead-sourcing", { body: { action: "cancel", job_id: job.id } });
    setCancelling(null);
    if (error || !data?.ok) return toast({ title: "Kunde inte avbryta sökning", description: error?.message ?? data?.error, variant: "destructive" });
    toast({ title: data.cancelled ? "Sökning avbruten" : "Jobbet var redan avslutat" });
    await load();
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><MapPinned className="h-5 w-5 text-primary" /><h1 className="text-2xl font-semibold">Lead sourcing</h1></div>
        <p className="mt-1 text-sm text-muted-foreground">Hämtar endast från marknader du har godkänt. Nya leads auditeras först och väntar sedan på ditt beslut innan en hemsida får byggas.</p>
      </div>
      <div className="flex gap-2">
        <Select value={language} onValueChange={(value) => { setLanguage(value as any); setMarketPage(0); }}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alla språk</SelectItem><SelectItem value="sv">Svenska</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select>
        <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
      </div>
    </div>

    <Card className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Automatisk påfyllning</p><p className="text-sm text-muted-foreground">Varje språk bygger ett lager på {settings.lead_stock_multiplier ?? 4} × dagens nya email-kapacitet, med ±{settings.stock_tolerance ?? 5} leads. Den pausar också när audit-, bygg- eller godkännandekön blir för stor.</p></div><div className="flex items-center gap-3"><Badge variant={settings.state === "auto" ? "default" : "secondary"}>{settings.state === "auto" ? "Automatisk" : settings.state === "paused" ? "Pausad" : "Manuell"}</Badge><Switch checked={settings.state === "auto"} onCheckedChange={(checked) => void changeState(checked ? "auto" : "manual")} /></div></div></Card>

    <div className="grid gap-4 md:grid-cols-2">{(["sv", "en"] as Language[]).map((lang) => { const item = sourcingStatus?.coverage.find((coverage) => coverage.language === lang); return <Card key={lang} className="p-5"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{lang === "sv" ? "Svensk sourcing-status" : "English sourcing status"}</p><p className="mt-1 text-sm text-muted-foreground">{item ? `${item.stock}/${item.target} leads · audit ${item.audit_backlog}/${item.backlog_cap} · granskning ${item.review_backlog}/${item.backlog_cap}` : "Läser status…"}</p></div><Badge variant={item?.should_source ? "default" : "secondary"}>{item?.should_source ? "Behöver leads" : "Väntar"}</Badge></div><p className="mt-3 text-sm text-muted-foreground">{item?.reason ?? "Ingen status ännu."}</p>{sourcingStatus?.active_job && <p className="mt-2 text-xs text-muted-foreground">Aktivt jobb: {sourcingStatus.active_job.search_query}</p>}{!sourcingStatus?.active_job && sourcingStatus?.next_market && item?.should_source && <p className="mt-2 text-xs text-muted-foreground">Nästa: {sourcingStatus.next_market.category} — {sourcingStatus.next_market.city}</p>}</Card>})}</div>

    <Card className="p-5 space-y-4">
      <div><h2 className="font-semibold">Sökplan: platser × nischer</h2><p className="mt-1 text-sm text-muted-foreground">Skriv flera platser och nischer på egna rader. Systemet skapar kombinationerna, men kör alltid en enda sökning i taget och hoppar över tidigare täckta marknader.</p></div>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant={matrixLanguage === "sv" ? "default" : "outline"} onClick={() => setMatrixLanguage("sv")}>Svenska</Button><Button size="sm" variant={matrixLanguage === "en" ? "default" : "outline"} onClick={() => setMatrixLanguage("en")}>English</Button></div>
      <div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-sm font-medium">Platser</p><Textarea value={citiesInput} onChange={(event) => setCitiesInput(event.target.value)} placeholder={matrixLanguage === "sv" ? "Stockholm\nGöteborg" : "Leeds\nBristol"} rows={5} /></div><div><p className="mb-2 text-sm font-medium">Nischer</p><Textarea value={nichesInput} onChange={(event) => setNichesInput(event.target.value)} placeholder="Hair salon" rows={5} /></div></div>
      <Button onClick={() => void addMatrix()} disabled={addingMatrix}>{addingMatrix ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPinned className="mr-2 h-4 w-4" />}Skapa säker sökplan</Button>
    </Card>

    <div className="grid gap-4 md:grid-cols-2">
      {(["sv", "en"] as Language[]).map((lang) => <Card key={lang} className="p-5"><div className="flex items-center justify-between"><div><p className="font-medium">{lang === "sv" ? "Svenska marknader" : "English markets"}</p><p className="text-sm text-muted-foreground">Kör en liten kontrollerad testhämtning.</p></div><Button onClick={() => void runNow(lang)} disabled={running !== null}>{running === lang ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Kör nu</Button></div></Card>)}
    </div>

    <Card className="overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Godkända marknader</h2><p className="mt-1 text-sm text-muted-foreground">Visar {marketTotal === 0 ? 0 : marketPage * MARKET_PAGE_SIZE + 1}–{Math.min((marketPage + 1) * MARKET_PAGE_SIZE, marketTotal)} av {marketTotal} marknader.</p></div><div className="divide-y">{shownMarkets.map((market) => <div key={market.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><span className="font-medium">{market.category} — {market.city}</span><Badge variant="outline">{market.language === "sv" ? "SV" : "EN"}</Badge></div><p className="text-sm text-muted-foreground">{market.search_query} · {market.max_results > 0 ? `max ${market.max_results}` : "ingen resultatgräns"} {market.last_scraped_at ? `· senast körd ${new Date(market.last_scraped_at).toLocaleDateString()}` : ""}</p></div><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{market.is_enabled ? "Aktiv" : "Täckt / pausad"}</span><Switch checked={market.is_enabled} onCheckedChange={(checked) => void toggleMarket(market, checked)} /></div></div>)}{!loading && shownMarkets.length === 0 && <p className="p-5 text-sm text-muted-foreground">Inga marknader för detta språk.</p>}</div>{marketTotal > MARKET_PAGE_SIZE && <div className="flex items-center justify-between border-t p-4"><Button variant="outline" size="sm" onClick={() => setMarketPage((page) => Math.max(0, page - 1))} disabled={marketPage === 0}>Föregående</Button><span className="text-sm text-muted-foreground">Sida {marketPage + 1} av {Math.ceil(marketTotal / MARKET_PAGE_SIZE)}</span><Button variant="outline" size="sm" onClick={() => setMarketPage((page) => page + 1)} disabled={(marketPage + 1) * MARKET_PAGE_SIZE >= marketTotal}>Nästa</Button></div>}</Card>

    <Card className="overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Redan täckta sökningar</h2></div><div className="divide-y">{history.filter((item) => language === "all" || item.language === language).slice(0, 30).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><span className="font-medium">{item.city} — {item.niche_key}</span><Badge variant="outline">{item.language.toUpperCase()}</Badge></div><p className="text-sm text-muted-foreground">{item.source === "legacy_local" ? `Lokalt tidigare: ${item.source_note ?? "query-lista"}` : item.search_query ?? "Server-sökning"}</p></div><span className="text-xs text-muted-foreground">{new Date(item.completed_at).toLocaleDateString()}</span></div>)}{!loading && history.filter((item) => language === "all" || item.language === language).length === 0 && <p className="p-5 text-sm text-muted-foreground">Ingen täckningshistorik ännu.</p>}</div></Card>

    <Card className="overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Senaste sourcing-jobb</h2></div><div className="divide-y">{shownJobs.map((job) => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><span className="font-medium">{job.search_query}</span><Badge className={stateColour[job.state] ?? "bg-slate-500"}>{job.state}</Badge></div><p className="text-sm text-muted-foreground">Hittade {job.discovered_count} · importerade {job.imported_count} · dubbletter {job.duplicate_count} · avvisade {job.rejected_count}</p>{job.error_message && <p className="mt-1 text-xs text-destructive">{job.error_message}</p>}</div><div className="flex items-center gap-3">{["queued", "dispatched", "running", "importing"].includes(job.state) && <Button variant="outline" size="sm" onClick={() => void cancelJob(job)} disabled={cancelling !== null}>{cancelling === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}Avbryt</Button>}<span className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString()}</span></div></div>)}{!loading && shownJobs.length === 0 && <p className="p-5 text-sm text-muted-foreground">Inga jobb ännu. Starta ett litet test med “Kör nu”.</p>}</div></Card>
  </div>;
}
