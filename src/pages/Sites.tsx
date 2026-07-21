import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, Search, ExternalLink, RefreshCw, Plus, Wand2, Rocket, Info, Play, Pause, StopCircle } from "lucide-react";
import { toast } from "sonner";

type SiteRow = {
  id: string;
  contact_id: string;
  status: string;
  template: string;
  source_url: string | null;
  audit_score: number | null;
  audit_reason: string | null;
  demo_site_url: string | null;
  github_repo_url: string | null;
  error_message: string | null;
  click_count: number;
  created_at: string;
  updated_at?: string;
  contacts?: { first_name: string | null; last_name: string | null; email: string | null };
};


const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  auditing: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  audited: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  scraping: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  scraped: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  queued: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  processing: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  generating: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  deploying: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  live: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  skipped: "bg-muted text-muted-foreground",
};


const Sites = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedList, setSelectedList] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [extraFor, setExtraFor] = useState<SiteRow | null>(null);
  const [extraMaps, setExtraMaps] = useState("");
  const [extraImagesText, setExtraImagesText] = useState("");
  const [savingExtra, setSavingExtra] = useState(false);

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ["generated_sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("generated_sites")
        .select("*, contacts(first_name,last_name,email)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as SiteRow[];
    },
    // Auto-refresh every 8s if anything is mid-flight, so the UI doesn't lie
    refetchInterval: (q) => {
      const rows = (q.state.data as SiteRow[] | undefined) ?? [];
      const inFlight = rows.some((r) =>
        ["auditing", "scraping", "queued", "processing", "generating", "deploying"].includes(r.status),
      );
      return inFlight ? 8000 : false;
    },
  });

  // Watchdog: any row that hasn't moved for >8 min in an in-flight state = worker
  // died AND cron didn't rescue it. Mark failed so user can retry.
  useEffect(() => {
    if (!sites.length) return;
    const stuck = sites.filter((s) => {
      if (!["queued", "processing", "generating", "deploying"].includes(s.status)) return false;
      const stamp = s.updated_at ?? s.created_at;
      const ageMs = Date.now() - new Date(stamp).getTime();
      return ageMs > 8 * 60 * 1000;

    });
    if (!stuck.length) return;
    (async () => {
      const ids = stuck.map((s) => s.id);
      await supabase
        .from("generated_sites")
        .update({
          status: "failed",
          error_message: "Timed out — no worker progress for 8 min. Click Generate to retry.",
        })
        .in("id", ids);
      qc.invalidateQueries({ queryKey: ["generated_sites"] });
    })();
  }, [sites, qc]);



  const { data: lists = [] } = useQuery({
    queryKey: ["contact_lists_for_sites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contact_lists").select("id,name").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Automation on/off switch (site_generation_state in app_settings).
  const { data: autoState = "running" } = useQuery({
    queryKey: ["site_generation_state"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "site_generation_state")
        .maybeSingle();
      return ((data?.value as any)?.state ?? "running") as "running" | "paused" | "stopped";
    },
    refetchInterval: 15_000,
  });
  const setAutoState = useMutation({
    mutationFn: async (state: "running" | "paused" | "stopped") => {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "site_generation_state", value: { state } as any, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: (_r, state) => {
      const label = state === "running" ? "Igång" : state === "paused" ? "Pausad" : "Stoppad";
      toast.success(`Automation: ${label}`);
      qc.invalidateQueries({ queryKey: ["site_generation_state"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const enrollList = useMutation({
    mutationFn: async (listId: string) => {
      if (!user) throw new Error("not signed in");
      const { data: contacts, error } = await supabase
        .from("contacts")
        .select("id")
        .eq("list_id", listId)
        .limit(500);
      if (error) throw error;
      if (!contacts?.length) throw new Error("List is empty");

      // Skip contacts that already have a site row
      const ids = contacts.map((c) => c.id);
      const { data: existing } = await supabase
        .from("generated_sites")
        .select("contact_id")
        .in("contact_id", ids);
      const skip = new Set((existing ?? []).map((e) => e.contact_id));
      const toInsert = ids.filter((id) => !skip.has(id)).map((id) => ({
        user_id: user.id,
        contact_id: id,
        status: "pending",
        template: "auto_workshop_v1",
      }));
      if (!toInsert.length) return { inserted: 0 };
      const { error: insErr } = await supabase.from("generated_sites").insert(toInsert);
      if (insErr) throw insErr;
      return { inserted: toInsert.length };
    },
    onSuccess: (r) => {
      toast.success(`Queued ${r.inserted} contact(s) for site generation`);
      qc.invalidateQueries({ queryKey: ["generated_sites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runStep = async (siteId: string, step: "audit-site" | "scrape-lead-data" | "generate-site" | "deploy-site") => {
    setBusyId(siteId);
    try {
      const { data, error } = await supabase.functions.invoke(step, {
        body: { generated_site_id: siteId },
      });
      // supabase-js hides the response body on non-2xx and gives a generic
      // "Failed to send a request" — dig it out so the user sees the real reason.
      if (error) {
        let detail = error.message;
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.text === "function") {
          try {
            const body = await ctx.text();
            if (body) detail = `${error.message}: ${body.slice(0, 300)}`;
          } catch { /* ignore */ }
        }
        throw new Error(detail);
      }
      toast.success(`${step} ${data?.status ? `→ ${data.status}` : "done"}`);
      qc.invalidateQueries({ queryKey: ["generated_sites"] });
      return data;
    } catch (e) {
      toast.error(`${step} failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };


  const openExtra = async (site: SiteRow) => {
    try {
      const { data, error } = await supabase
        .from("contacts")
        .select("custom_fields")
        .eq("id", site.contact_id)
        .single();
      if (error) throw error;
      const cf = (data?.custom_fields ?? {}) as Record<string, unknown>;
      setExtraMaps(typeof cf.google_maps_url === "string" ? cf.google_maps_url : "");
      setExtraImagesText(Array.isArray(cf.extra_images) ? (cf.extra_images as string[]).join("\n") : "");
      setExtraFor(site);
    } catch (e) {
      toast.error(`Could not load contact: ${(e as Error).message}`);
    }
  };

  const saveExtra = async () => {
    if (!extraFor) return;
    setSavingExtra(true);
    try {
      const { data: cur } = await supabase
        .from("contacts")
        .select("custom_fields")
        .eq("id", extraFor.contact_id)
        .single();
      const cf = { ...((cur?.custom_fields ?? {}) as Record<string, unknown>) };
      const images = extraImagesText.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
      if (extraMaps.trim()) cf.google_maps_url = extraMaps.trim(); else delete cf.google_maps_url;
      if (images.length) cf.extra_images = images; else delete cf.extra_images;
      const { error } = await supabase.from("contacts").update({ custom_fields: cf as any }).eq("id", extraFor.contact_id);
      if (error) throw error;
      toast.success(`Saved ${images.length} extra image(s)${extraMaps.trim() ? " + Maps link" : ""}`);
      setExtraFor(null);
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSavingExtra(false);
    }
  };

  const stats = {
    total: sites.length,
    live: sites.filter((s) => s.status === "live").length,
    failed: sites.filter((s) => s.status === "failed").length,
    skipped: sites.filter((s) => s.status === "skipped").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Generated Sites</h1>
          <p className="text-sm text-muted-foreground">
            Auto-generated demo websites, one per lead. Attach the URL to cold emails via <code>{"{{demo_site_url}}"}</code>.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.total}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Live</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-emerald-600">{stats.live}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Skipped (good site)</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{stats.skipped}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Failed</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-destructive">{stats.failed}</CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enroll a list</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={selectedList} onValueChange={setSelectedList}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Pick a contact list…" /></SelectTrigger>
            <SelectContent>
              {lists.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>Automation</span>
            <Badge variant="outline" className={
              autoState === "running" ? "text-emerald-600 border-emerald-600" :
              autoState === "paused" ? "text-amber-600 border-amber-600" :
              "text-destructive border-destructive"
            }>
              {autoState === "running" ? "Igång" : autoState === "paused" ? "Pausad" : "Stoppad"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={autoState === "running" ? "default" : "outline"}
            disabled={autoState === "running" || setAutoState.isPending}
            onClick={() => setAutoState.mutate("running")}
          >
            <Play className="h-4 w-4 mr-1" /> Starta
          </Button>
          <Button
            size="sm"
            variant={autoState === "paused" ? "default" : "outline"}
            disabled={autoState === "paused" || setAutoState.isPending}
            onClick={() => setAutoState.mutate("paused")}
          >
            <Pause className="h-4 w-4 mr-1" /> Pausa
          </Button>
          <Button
            size="sm"
            variant={autoState === "stopped" ? "destructive" : "outline"}
            disabled={autoState === "stopped" || setAutoState.isPending}
            onClick={() => setAutoState.mutate("stopped")}
          >
            <StopCircle className="h-4 w-4 mr-1" /> Stoppa
          </Button>
          <p className="text-xs text-muted-foreground ml-2">
            Styr om <code>process-site-leads</code> får starta nya hemsido-generationer.
            Redan pågående jobb slutförs. Manuella knappar nedan fungerar alltid.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enroll a list</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={selectedList} onValueChange={setSelectedList}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Pick a contact list…" /></SelectTrigger>
            <SelectContent>
              {lists.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            onClick={() => selectedList && enrollList.mutate(selectedList)}
            disabled={!selectedList || enrollList.isPending}
          >
            {enrollList.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Queue contacts
          </Button>
          <p className="text-xs text-muted-foreground">Creates one <code>generated_sites</code> row per contact (skips duplicates).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Sites ({sites.length})</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : sites.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No sites yet. Queue a contact list to start.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Demo URL</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sites.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="max-w-[220px]">
                        <div className="font-medium truncate">
                          {(s.contacts?.first_name || "") + " " + (s.contacts?.last_name || "")}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{s.contacts?.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColor[s.status] ?? ""} variant="outline">{s.status}</Badge>
                        {s.error_message && (
                          <div className="text-xs text-destructive mt-1 max-w-[220px] truncate" title={s.error_message}>
                            {s.error_message}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.audit_score != null ? (
                          <div>
                            <div className={s.audit_score >= 7 ? "text-emerald-600 font-semibold" : "font-semibold"}>{s.audit_score}/10</div>
                            {s.audit_reason && <div className="text-xs text-muted-foreground max-w-[200px] truncate" title={s.audit_reason}>{s.audit_reason}</div>}
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        {s.source_url ? (
                          <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 text-primary hover:underline max-w-[180px] truncate">
                            {s.source_url.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : <span className="text-muted-foreground text-xs">none</span>}
                      </TableCell>
                      <TableCell>
                        {s.demo_site_url ? (
                          <a href={s.demo_site_url} target="_blank" rel="noopener noreferrer" className="text-xs inline-flex items-center gap-1 text-primary hover:underline">
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" disabled={busyId === s.id} onClick={() => runStep(s.id, "audit-site")}>
                          {busyId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                          <span className="ml-1">Audit</span>
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyId === s.id || !s.source_url} onClick={() => runStep(s.id, "scrape-lead-data")}>
                          <Sparkles className="h-3 w-3" />
                          <span className="ml-1">Scrape</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === s.id || !["scraped","generated","live","failed"].includes(s.status)}
                          onClick={() => runStep(s.id, "generate-site")}
                          title={s.status === "live" ? "Regenerera hemsidan med befintlig scraped data (drar inga scrape-credits)" : "Generera hemsida från scraped data"}
                        >
                          <Wand2 className="h-3 w-3" />
                          <span className="ml-1">{["live","generated"].includes(s.status) ? "Regenerera" : "Generate"}</span>
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyId === s.id || !["generated","live","failed"].includes(s.status)} onClick={() => runStep(s.id, "deploy-site")}>
                          <Rocket className="h-3 w-3" />
                          <span className="ml-1">Deploy</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openExtra(s)} title="Add Google Maps link + extra images">
                          <Info className="h-3 w-3" />
                          <span className="ml-1">Extra</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!extraFor} onOpenChange={(o) => !o && setExtraFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Extra info for {extraFor?.contacts?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="maps">Google Maps embed URL</Label>
              <Input
                id="maps"
                placeholder="https://www.google.com/maps/embed?pb=..."
                value={extraMaps}
                onChange={(e) => setExtraMaps(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Öppna Google Maps → Dela → Bädda in en karta → kopiera src-URL:en (den som börjar med maps/embed).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="imgs">Extra bild-URLer (en per rad)</Label>
              <Textarea
                id="imgs"
                rows={6}
                placeholder="https://example.com/photo1.jpg&#10;https://example.com/photo2.jpg"
                value={extraImagesText}
                onChange={(e) => setExtraImagesText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Bilder från Google Maps, gamla hemsidan eller egna foton. Dessa prioriteras före Unsplash i genereringen.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExtraFor(null)}>Avbryt</Button>
            <Button onClick={saveExtra} disabled={savingExtra}>
              {savingExtra && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sites;
