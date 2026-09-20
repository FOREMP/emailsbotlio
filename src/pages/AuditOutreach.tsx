import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Mail, RefreshCw, Save, ShieldCheck } from "lucide-react";

type PipelineMode = "audit_only" | "demo_sites" | "paused";
type PipelineSettings = {
  mode: PipelineMode;
  sourcing_enabled: boolean;
  max_audit_score: number;
  require_reliable_audit: boolean;
  track_first_email: boolean;
  daily_first_touch_limit: number;
};
type SequenceNode = { id: string; node_type: string; position_y: number; config: Record<string, any> };
type StatRow = { sent: number; delivered: number; trackable: number; opened: number; replied: number; bounced: number; complained: number };
type QueueCounts = { total: number; active: number; waiting_first: number; waiting_followup: number; completed: number; stopped: number };
type RecentEmail = { id: string; recipient_email: string; subject: string | null; body: string | null; status: string; sent_at: string; opened_at: string | null; tracking_enabled: boolean };

const SEQUENCE_NAME = "English Audit Outreach";
const DEFAULT_SETTINGS: PipelineSettings = {
  mode: "audit_only",
  sourcing_enabled: true,
  max_audit_score: 5,
  require_reliable_audit: true,
  track_first_email: true,
  daily_first_touch_limit: 20,
};

export default function AuditOutreach() {
  const [settings, setSettings] = useState<PipelineSettings>(DEFAULT_SETTINGS);
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<SequenceNode[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [queue, setQueue] = useState<QueueCounts | null>(null);
  const [recent, setRecent] = useState<RecentEmail[]>([]);
  const [leadCounts, setLeadCounts] = useState({ pendingAudit: 0, manualReview: 0, eligible: 0 });
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingNode, setSavingNode] = useState<string | null>(null);
  const [dirtyNodes, setDirtyNodes] = useState<Record<string, Record<string, any>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: settingRow, error: settingError }, { data: sequence, error: sequenceError }] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "english_outreach_pipeline").maybeSingle(),
      supabase.from("sequences").select("id").eq("name", SEQUENCE_NAME).maybeSingle(),
    ]);
    if (settingError) toast({ title: "Kunde inte läsa inställningar", description: settingError.message, variant: "destructive" });
    if (sequenceError) toast({ title: "Kunde inte läsa sekvensen", description: sequenceError.message, variant: "destructive" });

    const raw = (settingRow?.value ?? {}) as Record<string, any>;
    setSettings({
      mode: raw.mode === "demo_sites" || raw.mode === "paused" ? raw.mode : "audit_only",
      sourcing_enabled: raw.sourcing_enabled !== false,
      max_audit_score: Math.max(1, Math.min(6, Number(raw.max_audit_score) || 5)),
      require_reliable_audit: raw.require_reliable_audit !== false,
      track_first_email: raw.track_first_email !== false,
      daily_first_touch_limit: Math.max(1, Math.min(100, Number(raw.daily_first_touch_limit) || 20)),
    });

    if (!sequence?.id) {
      setSequenceId(null);
      setNodes([]);
      setLoading(false);
      return;
    }
    setSequenceId(sequence.id);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [nodeResult, statResult, queueResult, recentResult, pendingResult, reviewResult, eligibleResult] = await Promise.all([
      supabase.from("sequence_nodes").select("id, node_type, position_y, config").eq("sequence_id", sequence.id).order("position_y"),
      supabase.rpc("get_site_outreach_stats", { p_sequence_id: sequence.id, p_since: since }),
      supabase.rpc("get_site_outreach_queue_counts", { p_sequence_id: sequence.id }),
      supabase.rpc("get_site_outreach_recent", { p_sequence_id: sequence.id, p_limit: 5 }),
      supabase.from("site_leads").select("id", { count: "exact", head: true }).eq("language", "en").eq("status", "pending_audit"),
      supabase.from("site_leads").select("id", { count: "exact", head: true }).eq("language", "en").in("status", ["awaiting_audit_approval", "needs_triage"]).eq("audit_score", 6),
      supabase.from("site_leads").select("id", { count: "exact", head: true }).eq("language", "en").eq("status", "auto_approved").is("last_email_sent_at", null),
    ]);
    if (nodeResult.error) toast({ title: "Kunde inte läsa mailstegen", description: nodeResult.error.message, variant: "destructive" });
    setNodes((nodeResult.data ?? []) as SequenceNode[]);
    setDirtyNodes({});
    setStats((statResult.data ?? []).map((row: any) => ({
      sent: Number(row.sent) || 0,
      delivered: Number(row.delivered) || 0,
      trackable: Number(row.trackable) || 0,
      opened: Number(row.opened) || 0,
      replied: Number(row.replied) || 0,
      bounced: Number(row.bounced) || 0,
      complained: Number(row.complained) || 0,
    })));
    const q = queueResult.data?.[0];
    setQueue(q ? {
      total: Number(q.total) || 0,
      active: Number(q.active) || 0,
      waiting_first: Number(q.waiting_first) || 0,
      waiting_followup: Number(q.waiting_followup) || 0,
      completed: Number(q.completed) || 0,
      stopped: Number(q.stopped) || 0,
    } : null);
    setRecent((recentResult.data ?? []) as RecentEmail[]);
    setLeadCounts({ pendingAudit: pendingResult.count ?? 0, manualReview: reviewResult.count ?? 0, eligible: eligibleResult.count ?? 0 });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sendNodes = useMemo(() => nodes.filter((node) => node.node_type === "send_email"), [nodes]);
  const totals = useMemo(() => stats.reduce((sum, row) => ({
    sent: sum.sent + row.sent,
    delivered: sum.delivered + row.delivered,
    trackable: sum.trackable + row.trackable,
    opened: sum.opened + row.opened,
    replied: sum.replied + row.replied,
    bounced: sum.bounced + row.bounced,
    complained: sum.complained + row.complained,
  }), { sent: 0, delivered: 0, trackable: 0, opened: 0, replied: 0, bounced: 0, complained: 0 }), [stats]);

  const saveSettings = async () => {
    if (!sequenceId) return;
    setSavingSettings(true);
    const clean: PipelineSettings = {
      ...settings,
      max_audit_score: Math.max(1, Math.min(6, Number(settings.max_audit_score) || 5)),
      daily_first_touch_limit: Math.max(1, Math.min(100, Number(settings.daily_first_touch_limit) || 20)),
    };
    const throttle = nodes.find((node) => node.node_type === "throttle");
    const firstEmail = sendNodes[0];
    const writes: PromiseLike<any>[] = [
      supabase.from("app_settings").upsert({ key: "english_outreach_pipeline", value: clean as any, updated_at: new Date().toISOString() }),
      supabase.from("sequences").update({ status: clean.mode === "paused" ? "paused" : "active" }).eq("id", sequenceId),
    ];
    if (throttle) writes.push(supabase.from("sequence_nodes").update({ config: { ...throttle.config, max_per_day: clean.daily_first_touch_limit } }).eq("id", throttle.id));
    if (firstEmail) writes.push(supabase.from("sequence_nodes").update({ config: { ...firstEmail.config, track_first_email: clean.track_first_email } }).eq("id", firstEmail.id));
    const results = await Promise.all(writes);
    const error = results.find((result: any) => result.error)?.error;
    setSavingSettings(false);
    if (error) return toast({ title: "Kunde inte spara", description: error.message, variant: "destructive" });
    setSettings(clean);
    toast({ title: "English audit outreach uppdaterad" });
    await load();
  };

  const updateNode = (node: SequenceNode, patch: Record<string, any>) => {
    setDirtyNodes((current) => ({ ...current, [node.id]: { ...(current[node.id] ?? node.config), ...patch } }));
  };

  const saveNode = async (node: SequenceNode) => {
    const config = dirtyNodes[node.id];
    if (!config) return;
    setSavingNode(node.id);
    const { error } = await supabase.from("sequence_nodes").update({ config }).eq("id", node.id);
    setSavingNode(null);
    if (error) return toast({ title: "Kunde inte spara prompt", description: error.message, variant: "destructive" });
    setNodes((current) => current.map((item) => item.id === node.id ? { ...item, config } : item));
    setDirtyNodes((current) => { const next = { ...current }; delete next[node.id]; return next; });
    toast({ title: "Prompt sparad" });
  };

  if (loading) return <div className="flex min-h-[320px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2"><h1 className="text-2xl font-bold">English Audit Outreach</h1><Badge variant={settings.mode === "paused" ? "secondary" : "default"}>{settings.mode}</Badge></div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">English leads are scraped and audited first. Reliable sites scoring 1–{settings.max_audit_score} are enrolled without building a demo. Swedish demo outreach is not changed.</p>
      </div>
      <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Uppdatera</Button>
    </div>

    {!sequenceId && <Card className="border-amber-500/50 p-5"><p className="font-medium">Sekvensen saknas</p><p className="mt-1 text-sm text-muted-foreground">Kör den nya Supabase-migrationen innan funktionen aktiveras.</p></Card>}

    <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
      {[
        ["Skickade 30 dagar", totals.sent], ["Spårbara", totals.trackable], ["Öppnade", totals.opened],
        ["Svar", totals.replied], ["Väntar första mail", queue?.waiting_first ?? 0], ["Aktiva", queue?.active ?? 0],
      ].map(([label, value]) => <Card key={String(label)} className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></Card>)}
    </div>

    <Card className="p-5">
      <div className="mb-5 flex items-center gap-2"><ShieldCheck className="h-5 w-5" /><div><h2 className="font-semibold">Pipeline controls</h2><p className="text-sm text-muted-foreground">Changes are reversible. Demo generation remains available in the second mode.</p></div></div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-2"><Label>English pipeline mode</Label><Select value={settings.mode} onValueChange={(mode) => setSettings((s) => ({ ...s, mode: mode as PipelineMode }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="audit_only">Audit only — no demo</SelectItem><SelectItem value="demo_sites">Build demo websites</SelectItem><SelectItem value="paused">Paused</SelectItem></SelectContent></Select></div>
        <div className="space-y-2"><Label>Highest score sent automatically</Label><Input type="number" min={1} max={6} value={settings.max_audit_score} onChange={(event) => setSettings((s) => ({ ...s, max_audit_score: Number(event.target.value) }))} /><p className="text-xs text-muted-foreground">Recommended: 5. Score 6 remains manual; 7–10 is parked.</p></div>
        <div className="space-y-2"><Label>New contacts per day</Label><Input type="number" min={1} max={100} value={settings.daily_first_touch_limit} onChange={(event) => setSettings((s) => ({ ...s, daily_first_touch_limit: Number(event.target.value) }))} /><p className="text-xs text-muted-foreground">Start at 20; follow-ups use their separate mailbox budget.</p></div>
        <label className="flex items-center justify-between rounded-lg border p-3"><span><span className="block text-sm font-medium">Automatic English sourcing</span><span className="text-xs text-muted-foreground">Refill stock from approved markets</span></span><Switch checked={settings.sourcing_enabled} onCheckedChange={(value) => setSettings((s) => ({ ...s, sourcing_enabled: value }))} /></label>
        <label className="flex items-center justify-between rounded-lg border p-3"><span><span className="block text-sm font-medium">Require reliable screenshot</span><span className="text-xs text-muted-foreground">Errors and uncertain audits stay manual</span></span><Switch checked={settings.require_reliable_audit} onCheckedChange={(value) => setSettings((s) => ({ ...s, require_reliable_audit: value }))} /></label>
        <label className="flex items-center justify-between rounded-lg border p-3"><span><span className="block text-sm font-medium">Track first-email opens</span><span className="text-xs text-muted-foreground">Only changes this sequence</span></span><Switch checked={settings.track_first_email} onCheckedChange={(value) => setSettings((s) => ({ ...s, track_first_email: value }))} /></label>
      </div>
      <div className="mt-5 flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground">Audit backlog: {leadCounts.pendingAudit} · manual score 6: {leadCounts.manualReview} · enrolled but unsent: {leadCounts.eligible}</p><Button onClick={() => void saveSettings()} disabled={!sequenceId || savingSettings}>{savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Spara</Button></div>
    </Card>

    <div className="space-y-4">
      <div><h2 className="text-lg font-semibold">Three-email sequence</h2><p className="text-sm text-muted-foreground">Each prompt receives verified audit observations. Signatures and unsubscribe handling are appended by the sender.</p></div>
      {sendNodes.map((node, index) => {
        const config = dirtyNodes[node.id] ?? node.config;
        return <Card key={node.id} className="p-5">
          <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><Mail className="h-4 w-4" /><h3 className="font-medium">Email {index + 1}</h3><Badge variant="outline">{index === 0 ? "Day 0" : index === 1 ? "After 3 days" : "After 7 days"}</Badge></div><Button size="sm" onClick={() => void saveNode(node)} disabled={!dirtyNodes[node.id] || savingNode === node.id}>{savingNode === node.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save prompt</Button></div>
          <div className="space-y-4"><div className="space-y-2"><Label>Body prompt</Label><Textarea className="min-h-[260px] font-mono text-xs" value={config.prompt ?? ""} onChange={(event) => updateNode(node, { prompt: event.target.value })} /></div><div className="space-y-2"><Label>Subject prompt</Label><Textarea className="min-h-[90px] font-mono text-xs" value={config.subject_prompt ?? ""} onChange={(event) => updateNode(node, { subject_prompt: event.target.value })} /></div></div>
        </Card>;
      })}
    </div>

    <Card className="overflow-hidden">
      <div className="border-b p-5"><h2 className="font-semibold">Latest emails</h2></div>
      <div className="divide-y">{recent.length ? recent.map((email) => <div key={email.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{email.recipient_email}</p><p className="text-sm text-muted-foreground">{email.subject}</p></div><div className="flex gap-2"><Badge variant="outline">{email.status}</Badge><Badge variant={email.tracking_enabled ? "default" : "secondary"}>{email.tracking_enabled ? email.opened_at ? "Opened" : "Tracked" : "Untracked"}</Badge></div></div></div>) : <p className="p-5 text-sm text-muted-foreground">No audit-outreach emails sent yet.</p>}</div>
    </Card>
  </div>;
}
