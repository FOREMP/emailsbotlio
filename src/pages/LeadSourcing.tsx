import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPinned, Loader2, Play, RefreshCw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";

type Language = "sv" | "en";
type Market = { id: string; language: Language; country_code: string; city: string; category: string; search_query: string; is_enabled: boolean; priority: number; max_results: number; cooldown_days: number; last_scraped_at: string | null };
type Job = { id: string; language: Language; search_query: string; state: string; max_results: number; discovered_count: number; imported_count: number; duplicate_count: number; rejected_count: number; error_message: string | null; created_at: string };
type Settings = { state?: "manual" | "auto" | "paused"; buffer_days?: number };

const db = supabase as any;
const starterMarkets = (userId: string): Omit<Market, "id" | "last_scraped_at">[] => [
  { user_id: userId, language: "sv", country_code: "SE", city: "Stockholm", category: "Hair salon", search_query: "frisör Stockholm Sverige", is_enabled: true, priority: 10, max_results: 75, cooldown_days: 21 },
  { user_id: userId, language: "en", country_code: "GB", city: "Leeds", category: "Hair salon", search_query: "hair salon Leeds UK", is_enabled: true, priority: 10, max_results: 75, cooldown_days: 21 },
] as any;

const stateColour: Record<string, string> = { completed: "bg-emerald-500", failed: "bg-red-600", running: "bg-blue-500", importing: "bg-blue-500", dispatched: "bg-amber-500", queued: "bg-amber-500" };

export default function LeadSourcing() {
  const { user } = useAuth();
  const [language, setLanguage] = useState<"all" | Language>("all");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<Settings>({ state: "manual", buffer_days: 3 });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<Language | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const marketQuery = db.from("lead_markets").select("*").eq("user_id", user.id).order("priority").order("city");
    const [{ data: existing, error: marketError }, { data: settingRow }] = await Promise.all([
      marketQuery,
      db.from("app_settings").select("value").eq("key", "lead_sourcing_state").maybeSingle(),
    ]);
    if (marketError) {
      toast({ title: "Lead sourcing är inte installerat ännu", description: marketError.message, variant: "destructive" });
      setLoading(false); return;
    }
    let currentMarkets = (existing ?? []) as Market[];
    // First visit seeds only the two markets explicitly approved for this rollout.
    if (currentMarkets.length === 0) {
      const { data, error } = await db.from("lead_markets").insert(starterMarkets(user.id)).select("*");
      if (error) toast({ title: "Kunde inte lägga till startmarknader", description: error.message, variant: "destructive" });
      else currentMarkets = (data ?? []) as Market[];
    }
    const { data: jobRows, error: jobError } = await db.from("lead_scrape_jobs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    if (jobError) toast({ title: "Kunde inte ladda sourcing-jobb", description: jobError.message, variant: "destructive" });
    setMarkets(currentMarkets);
    setJobs((jobRows ?? []) as Job[]);
    setSettings((settingRow?.value ?? { state: "manual", buffer_days: 3 }) as Settings);
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const shownMarkets = useMemo(() => language === "all" ? markets : markets.filter((market) => market.language === language), [language, markets]);
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
        <Select value={language} onValueChange={(value) => setLanguage(value as any)}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Alla språk</SelectItem><SelectItem value="sv">Svenska</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select>
        <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
      </div>
    </div>

    <Card className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">Automatisk påfyllning</p><p className="text-sm text-muted-foreground">När lagret går under ungefär {settings.buffer_days ?? 3} dagars behov väljs nästa godkända marknad. Starta i manuellt läge tills första testet är godkänt.</p></div><div className="flex items-center gap-3"><Badge variant={settings.state === "auto" ? "default" : "secondary"}>{settings.state === "auto" ? "Automatisk" : settings.state === "paused" ? "Pausad" : "Manuell"}</Badge><Switch checked={settings.state === "auto"} onCheckedChange={(checked) => void changeState(checked ? "auto" : "manual")} /></div></div></Card>

    <div className="grid gap-4 md:grid-cols-2">
      {(["sv", "en"] as Language[]).map((lang) => <Card key={lang} className="p-5"><div className="flex items-center justify-between"><div><p className="font-medium">{lang === "sv" ? "Svenska marknader" : "English markets"}</p><p className="text-sm text-muted-foreground">Kör en liten kontrollerad testhämtning.</p></div><Button onClick={() => void runNow(lang)} disabled={running !== null}>{running === lang ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Kör nu</Button></div></Card>)}
    </div>

    <Card className="overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Godkända marknader</h2></div><div className="divide-y">{shownMarkets.map((market) => <div key={market.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><span className="font-medium">{market.category} — {market.city}</span><Badge variant="outline">{market.language === "sv" ? "SV" : "EN"}</Badge></div><p className="text-sm text-muted-foreground">{market.search_query} · max {market.max_results} · var {market.cooldown_days}:e dag</p></div><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{market.is_enabled ? "Aktiv" : "Pausad"}</span><Switch checked={market.is_enabled} onCheckedChange={(checked) => void toggleMarket(market, checked)} /></div></div>)}{!loading && shownMarkets.length === 0 && <p className="p-5 text-sm text-muted-foreground">Inga marknader för detta språk.</p>}</div></Card>

    <Card className="overflow-hidden"><div className="border-b p-5"><h2 className="font-semibold">Senaste sourcing-jobb</h2></div><div className="divide-y">{shownJobs.map((job) => <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><span className="font-medium">{job.search_query}</span><Badge className={stateColour[job.state] ?? "bg-slate-500"}>{job.state}</Badge></div><p className="text-sm text-muted-foreground">Hittade {job.discovered_count} · importerade {job.imported_count} · dubbletter {job.duplicate_count} · avvisade {job.rejected_count}</p>{job.error_message && <p className="mt-1 text-xs text-destructive">{job.error_message}</p>}</div><div className="flex items-center gap-3">{["queued", "dispatched", "running", "importing"].includes(job.state) && <Button variant="outline" size="sm" onClick={() => void cancelJob(job)} disabled={cancelling !== null}>{cancelling === job.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}Avbryt</Button>}<span className="text-xs text-muted-foreground">{new Date(job.created_at).toLocaleString()}</span></div></div>)}{!loading && shownJobs.length === 0 && <p className="p-5 text-sm text-muted-foreground">Inga jobb ännu. Starta ett litet test med “Kör nu”.</p>}</div></Card>
  </div>;
}
