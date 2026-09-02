// Control center for the Site Demo Outreach sequence.
// Shows the enrollment queue, last 5 sent mails, and the prompts for each of the 4 steps.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, StopCircle, Mail, Save, Eye, Gauge, BarChart3 } from "lucide-react";
import { VolumeTrendChart } from "@/components/analytics/VolumeTrendChart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  annotateSteps,
  computeDailySeries,
  computeKpis,
  filterByStep,
  type StepFilter,
  type SentEmailRow,
} from "@/hooks/useAnalytics";

type Seq = { id: string; contact_list_id: string | null };
type Node = { id: string; node_type: string; position_y: number; config: any };
type EnrollRow = {
  id: string;
  status: string;
  current_step: number;
  current_node_id: string | null;
  next_send_at: string | null;
  last_sent_at: string | null;
  created_at?: string | null;
  contact: { id: string; email: string | null; first_name: string | null; custom_fields: any } | null;
};
type SentRow = {
  id: string;
  sent_at: string;
  subject: string | null;
  body: string | null;
  recipient_email: string;
  status: string;
  open_count: number;
  opened_at: string | null;
  contact_id: string | null;
  enrollment_id?: string | null;
  tracking_enabled?: boolean | null;
  tracking_route?: "none" | "custom" | "supabase" | null;
  tracking_url?: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-500",
  waiting_capacity: "bg-amber-500",
  completed: "bg-slate-500",
  stopped: "bg-red-500",
  unsubscribed: "bg-red-500",
  failed: "bg-red-600",
};

const STOCKHOLM_TZ = "Europe/Stockholm";
const COUNTED_SEND_STATUSES = new Set(["queued", "sent", "bounced", "complained", "unsubscribed"]);

const stockholmDateKey = (value: string | Date): string | null => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STOCKHOLM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

export default function SiteOutreach() {
  const [language, setLanguage] = useState<"sv" | "en">("sv");
  const [seq, setSeq] = useState<Seq | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollRow[]>([]);
  const [recent, setRecent] = useState<SentRow[]>([]);
  const [statsRows, setStatsRows] = useState<SentEmailRow[]>([]);
  const [allSentRows, setAllSentRows] = useState<SentEmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<SentRow | null>(null);
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingLimit, setSavingLimit] = useState(false);
  const [stepFilter, setStepFilter] = useState<StepFilter>("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // The queue table is long, so it stays collapsed until asked for.
  const [queueOpen, setQueueOpen] = useState(() => {
    try { return localStorage.getItem("outreach-queue-open") === "1"; } catch { return false; }
  });
  const [queuePage, setQueuePage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setSeq(null);
    setNodes([]);
    setEnrollments([]);
    setRecent([]);
    setStatsRows([]);
    setAllSentRows([]);
    setDirty({});

    const sequenceName = language === "en" ? "Site Demo Outreach EN" : "Site Demo Outreach";
    const { data: s, error: seqError } = await supabase
      .from("sequences")
      .select("id, contact_list_id")
      .eq("name", sequenceName)
      .maybeSingle();

    if (seqError) {
      toast({ title: "Kunde inte ladda outreach", description: seqError.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    if (!s?.id) {
      setLoading(false);
      return;
    }
    setSeq(s as Seq);

    const [{ data: ns }, { data: enrsRaw }] = await Promise.all([
      supabase.from("sequence_nodes").select("id, node_type, position_y, config").eq("sequence_id", s.id).order("position_y"),
      supabase
        .from("enrollments")
        .select("id, status, current_step, current_node_id, next_send_at, last_sent_at, created_at, contact_id")
        .eq("sequence_id", s.id)
        .order("updated_at", { ascending: false })
        .limit(200),
    ]);

    const enrs = enrsRaw ?? [];
    const contactIds = Array.from(new Set(enrs.map((e: any) => e.contact_id).filter(Boolean)));
    const { data: contactRows } = contactIds.length
      ? await supabase.from("contacts").select("id, email, first_name, custom_fields").in("id", contactIds)
      : { data: [] as any[] };
    const contactMap = new Map((contactRows ?? []).map((c: any) => [c.id, c]));
    const enrsWithContact = enrs.map((e: any) => ({ ...e, contact: contactMap.get(e.contact_id) ?? null }));

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const visibleEnrollmentIds = enrs.map((row: any) => row.id as string);
    const visibleSent: SentEmailRow[] = [];
    for (let i = 0; i < visibleEnrollmentIds.length; i += 200) {
      const chunk = visibleEnrollmentIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from("sent_emails")
        .select("id, recipient_email, status, sent_at, opened_at, replied_at, sender_id, enrollment_id, subject, body, open_count, contact_id, tracking_enabled, tracking_route, tracking_url")
        .in("enrollment_id", chunk)
        .order("sent_at", { ascending: false });
      if (error) {
        toast({ title: "Kunde inte ladda mailhistorik", description: error.message, variant: "destructive" });
      } else if (data) {
        visibleSent.push(...(data as SentEmailRow[]));
      }
    }

    // Supabase REST responses are capped, so page through every enrollment id.
    const allEnrIds: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("enrollments")
        .select("id")
        .eq("sequence_id", s.id)
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error) {
        toast({ title: "Kunde inte ladda sekvensstatistik", description: error.message, variant: "destructive" });
        break;
      }
      const page = data ?? [];
      allEnrIds.push(...page.map((row: any) => row.id as string));
      if (page.length < 1000) break;
    }

    // The query below selects the analytics columns plus the extra ones the
    // preview list needs (body, open_count, contact_id), so rows satisfy both.
    const stats: (SentEmailRow & SentRow)[] = [];
    for (let i = 0; i < allEnrIds.length; i += 200) {
      const chunk = allEnrIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from("sent_emails")
        .select("id, recipient_email, status, sent_at, opened_at, replied_at, sender_id, enrollment_id, subject, body, open_count, contact_id, tracking_enabled, tracking_route, tracking_url")
        .in("enrollment_id", chunk)
        .gte("sent_at", since30)
        .order("sent_at", { ascending: false })
        .limit(5000);
      if (error) {
        toast({ title: "Kunde inte ladda 30-dagarsstatistik", description: error.message, variant: "destructive" });
      } else if (data) {
        stats.push(...(data as unknown as (SentEmailRow & SentRow)[]));
      }
    }

    const sent: SentRow[] = stats
      .slice()
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
      .slice(0, 5);


    setNodes((ns ?? []) as Node[]);
    setEnrollments(enrsWithContact as any);
    setRecent(sent);
    setStatsRows(stats);
    setAllSentRows(visibleSent);
    setLoading(false);
  }, [language]);

  // No polling: the page only refreshes on open, on language switch, after an
  // action, or when you press "Uppdatera".
  useEffect(() => {
    load().then(() => setLastUpdated(new Date()));
  }, [load]);


  const sendNodes = useMemo(
    () => nodes.filter((n) => n.node_type === "send_email").sort((a, b) => a.position_y - b.position_y),
    [nodes],
  );
  const waitNodes = useMemo(
    () => nodes.filter((n) => n.node_type === "wait").sort((a, b) => a.position_y - b.position_y),
    [nodes],
  );
  const throttleNodes = useMemo(
    () => nodes.filter((n) => n.node_type === "throttle").sort((a, b) => a.position_y - b.position_y),
    [nodes],
  );

  const cfgVal = (node: Node, key: string) => (dirty[node.id]?.[key] ?? node.config?.[key] ?? "");
  const dailyLimitNode = throttleNodes[0] ?? null;
  const dailyLimit = Number(dailyLimitNode ? cfgVal(dailyLimitNode, "max_per_day") : 16) || 16;

  const sentCountByEnrollment = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of allSentRows) {
      const eid = row.enrollment_id as string | null;
      if (!eid) continue;
      if (!COUNTED_SEND_STATUSES.has(row.status)) continue;
      map.set(eid, (map.get(eid) ?? 0) + 1);
    }
    return map;
  }, [allSentRows]);

  const displayStep = useCallback((e: EnrollRow) => {
    const sentCount = Math.min(sentCountByEnrollment.get(e.id) ?? 0, 4);
    if (e.status === "completed" || sentCount >= 4) return "Klar (4/4)";
    if (e.status === "stopped" || e.status === "unsubscribed") return "Stoppad";
    if (e.status === "failed") return `Avbruten (${sentCount}/4)`;
    const nextMail = Math.min(sentCount + 1, 4);
    return `Mail ${nextMail} av 4`;
  }, [sentCountByEnrollment]);

  const counts = useMemo(() => {
    const todayKey = stockholmDateKey(new Date());
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const queuedRows = enrollments.filter((e) => e.status === "active" || e.status === "waiting_capacity");
    const active = queuedRows.length;
    const waiting = queuedRows.length;
    const waitingFirst = queuedRows.filter((e) => (sentCountByEnrollment.get(e.id) ?? 0) === 0).length;
    const waitingFollowup = waiting - waitingFirst;
    const completed = enrollments.filter((e) => e.status === "completed").length;
    const stopped = enrollments.filter((e) => e.status === "stopped" || e.status === "unsubscribed").length;
    const newLast24h = enrollments.filter((e) => e.created_at && new Date(e.created_at).getTime() >= dayAgo).length;

    let sentFirstToday = 0;
    let sentFollowupToday = 0;
    for (const r of annotateSteps(statsRows)) {
      if (stockholmDateKey(r.sent_at) !== todayKey) continue;
      if (r.tracking_enabled || r.stepIndex > 1) sentFollowupToday += 1;
      else sentFirstToday += 1;
    }

    return {
      active,
      waiting,
      waitingFirst,
      waitingFollowup,
      completed,
      stopped,
      newLast24h,
      sentFirstToday,
      sentFollowupToday,
      sentToday: sentFirstToday + sentFollowupToday,
    };
  }, [enrollments, sentCountByEnrollment, statsRows]);

  const stopEnrollment = async (id: string, reason: string) => {
    if (!confirm(`Stoppa denna kontakt från fler mail? (${reason})`)) return;
    const { error } = await supabase.from("enrollments").update({
      status: "stopped",
      last_error: `manually stopped: ${reason}`,
      error_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return toast({ title: "Fel", description: error.message, variant: "destructive" });
    toast({ title: "Stoppad" });
    load();
  };

  const saveNode = async (nodeId: string) => {
    const patch = dirty[nodeId];
    if (!patch) return;
    setSavingId(nodeId);
    const current = nodes.find((n) => n.id === nodeId);
    const nextConfig = { ...(current?.config ?? {}), ...patch };
    const { error } = await supabase.from("sequence_nodes").update({ config: nextConfig }).eq("id", nodeId);
    setSavingId(null);
    if (error) return toast({ title: "Kunde inte spara", description: error.message, variant: "destructive" });
    setDirty((d) => {
      const c = { ...d };
      delete c[nodeId];
      return c;
    });
    toast({ title: "Sparat" });
    load();
  };

  const saveDailyLimit = async () => {
    if (!seq || !dailyLimitNode) return;
    const nextLimit = Math.max(1, Math.floor(dailyLimit));
    setSavingLimit(true);
    try {
      for (const n of throttleNodes) {
        const cfg = { ...(n.config ?? {}), max_per_day: nextLimit };
        const { error } = await supabase.from("sequence_nodes").update({ config: cfg }).eq("id", n.id);
        if (error) throw error;
      }

      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (uid) {
        const allowedDomains = new Set(
          sendNodes
            .flatMap((node) => String(node.config?.sender_domain ?? "")
              .split(",")
              .map((value: string) => value.trim().toLowerCase())
              .filter(Boolean)),
        );
        const fallbackDomains = language === "en" ? ["foremp.eu", "foremp.one"] : ["foremp.email"];
        fallbackDomains.forEach((domain) => allowedDomains.add(domain));

        const { data: forempSenders } = await supabase
          .from("senders")
          .select("id, from_email")
          .eq("user_id", uid)
          .eq("is_active", true);

        const scopedSenders = (forempSenders ?? []).filter((sender: any) => {
          const domain = String(sender.from_email ?? "").split("@")[1]?.toLowerCase() ?? "";
          return allowedDomains.has(domain);
        });

        const perSender = Math.max(1, Math.ceil(nextLimit / Math.max(scopedSenders.length, 1)));
        for (const sender of scopedSenders) {
          const { error } = await supabase.from("senders").update({ daily_limit: perSender }).eq("id", sender.id);
          if (error) throw error;
        }
      }

      setDirty((d) => {
        const c = { ...d };
        for (const n of throttleNodes) delete c[n.id];
        return c;
      });
      toast({
        title: "Daglig gräns sparad",
        description: `${nextLimit} nya första mail/dag. Follow-ups ligger utanför den gränsen.`,
      });
      load();
    } catch (e) {
      toast({ title: "Kunde inte spara gräns", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingLimit(false);
    }
  };

  const updateDirty = (nodeId: string, key: string, value: any) => {
    setDirty((d) => ({ ...d, [nodeId]: { ...(d[nodeId] ?? {}), [key]: value } }));
  };

  const steppedStats = useMemo(() => annotateSteps(statsRows), [statsRows]);
  const filteredStats = useMemo(() => filterByStep(steppedStats, stepFilter), [steppedStats, stepFilter]);
  const stepBreakdown = useMemo(() => {
    const map = new Map<number, { step: number; sent: number; trackable: number; opened: number; replied: number }>();
    for (const row of filteredStats) {
      const step = Math.min(row.stepIndex, 4);
      const entry = map.get(step) ?? { step, sent: 0, trackable: 0, opened: 0, replied: 0 };
      entry.sent += 1;
      if (row.tracking_enabled) {
        entry.trackable += 1;
        if (row.opened_at) entry.opened += 1;
      }
      if (row.replied_at) entry.replied += 1;
      map.set(step, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.step - b.step);
  }, [filteredStats]);

  const contactById = (id: string | null) => enrollments.find((e) => e.contact?.id === id)?.contact ?? null;

  if (loading) return <div className="text-sm text-muted-foreground">Laddar…</div>;

  if (!seq) {
    return (
      <Card className="p-8 text-center space-y-2">
        <h2 className="text-lg font-semibold">{language === "en" ? "Site Demo Outreach EN saknas" : "Site Demo Outreach saknas"}</h2>
        <p className="text-sm text-muted-foreground">Kör seed-migrationen för att skapa sekvensen.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Demo Outreach</h1>
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant={language === "sv" ? "default" : "outline"} onClick={() => setLanguage("sv")}>
            Svenska
          </Button>
          <Button size="sm" variant={language === "en" ? "default" : "outline"} onClick={() => setLanguage("en")}>
            English
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {language === "en" ? "4-mail English sequence from @foremp.eu" : "4-mails svensk sekvens från @foremp.email"} — <strong>skickas endast måndag–fredag 09:00 Stockholm-tid</strong>.
          Fylls på automatiskt när du godkänner demos i Approvals (kontakt, hemsidelänk och audit-info följer med).
        </p>
      </div>

      <Card className="p-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Gauge className="h-4 w-4" /> Daglig utskicksgräns</h2>
          <p className="text-xs text-muted-foreground">
            Räknar endast <strong>nya första mail</strong> per dag. Follow-ups skickas alltid ovanpå detta.
            {language === "en"
              ? " Totalen delas mellan aktiva @foremp.eu/@foremp.one-senders."
              : " Totalen delas jämnt mellan aktiva @foremp.email-senders."}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium">Max mail per dag</label>
            <Input
              type="number"
              min={1}
              className="w-32"
              value={dailyLimit}
              onChange={(e) => dailyLimitNode && updateDirty(dailyLimitNode.id, "max_per_day", Number(e.target.value))}
            />
          </div>
          <Button onClick={saveDailyLimit} disabled={!dailyLimitNode || savingLimit || !dirty[dailyLimitNode.id]} className="gap-1">
            {savingLimit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Spara gräns
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Aktiva" value={counts.active} />
        <StatCard label="Väntar på första mail" value={counts.waitingFirst} />
        <StatCard label="Väntar på uppföljning" value={counts.waitingFollowup} />
        <StatCard label="Nya i kön (24h)" value={counts.newLast24h} />
        <StatCard label={`Nya mail i dag (av ${dailyLimit})`} value={counts.sentFirstToday} />
        <StatCard label="Uppföljningar i dag" value={counts.sentFollowupToday} />
        <StatCard label="Klara" value={counts.completed} />
        <StatCard label="Stoppade" value={counts.stopped} />
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Statistik (senaste 30 dagar)</h2>
            <p className="text-xs text-muted-foreground">Skickade, öppnade och besvarade mail per dag för Site Demo Outreach.</p>
            <p className="text-xs text-muted-foreground">Visar nu: {language === "en" ? "English / foremp.eu" : "Svenska / foremp.email"}.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={stepFilter} onValueChange={(value) => setStepFilter(value as StepFilter)}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Steg" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla utskick</SelectItem>
                <SelectItem value="first">Endast första mailet</SelectItem>
                <SelectItem value="followups">Endast uppföljningar</SelectItem>
                <SelectItem value="step-2">Mail 2 (första uppföljningen)</SelectItem>
                <SelectItem value="step-3">Mail 3</SelectItem>
                <SelectItem value="step-4">Mail 4</SelectItem>
              </SelectContent>
            </Select>
            {(() => {
              const k = computeKpis(filteredStats);
              return (
                <div className="flex gap-4 text-xs">
                  <div><div className="text-muted-foreground">Skickade</div><div className="text-base font-semibold">{k.sent}</div></div>
                  <div><div className="text-muted-foreground">Öppnade</div><div className="text-base font-semibold">{k.opened} ({Math.round(k.openRate * 100)}%)</div></div>
                  <div><div className="text-muted-foreground">Spårbara</div><div className="text-base font-semibold">{k.trackable}</div></div>
                  <div><div className="text-muted-foreground">Ospårade</div><div className="text-base font-semibold">{k.untracked}</div></div>
                  <div><div className="text-muted-foreground">Besvarade</div><div className="text-base font-semibold">{k.replied}</div></div>
                  <div><div className="text-muted-foreground">Bounces</div><div className="text-base font-semibold">{k.bounced}</div></div>
                </div>
              );
            })()}
          </div>
        </div>
        <VolumeTrendChart data={computeDailySeries(filteredStats, 30)} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground text-left border-b">
              <tr>
                <th className="py-2 pr-3">Steg</th>
                <th className="py-2 pr-3">Skickade</th>
                <th className="py-2 pr-3">Spårbara</th>
                <th className="py-2 pr-3">Öppnade</th>
                <th className="py-2 pr-3">Öppningsgrad</th>
                <th className="py-2 pr-3">Svar</th>
              </tr>
            </thead>
            <tbody>
              {stepBreakdown.map((row) => (
                <tr key={row.step} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-medium">Mail {row.step}</td>
                  <td className="py-2 pr-3">{row.sent}</td>
                  <td className="py-2 pr-3">{row.trackable}</td>
                  <td className="py-2 pr-3">{row.opened}</td>
                  <td className="py-2 pr-3">{row.trackable ? Math.round((row.opened / row.trackable) * 100) : 0}%</td>
                  <td className="py-2 pr-3">{row.replied}</td>
                </tr>
              ))}
              {stepBreakdown.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground text-xs">Ingen data ännu.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-3">Kö</h2>
        {enrollments.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Ingen har enrollats än — godkänn en demo i Approvals.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground text-left border-b">
                <tr>
                  <th className="py-2 pr-3">Företag</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Nästa steg</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Skickat</th>
                  <th className="py-2 pr-3">Nästa sändning</th>
                  <th className="py-2 pr-3">Senast skickat</th>
                  <th className="py-2 pr-3 text-right">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {pagedEnrollments.map((e) => {
                  const company = e.contact?.custom_fields?.company_name ?? "—";
                  return (
                    <tr key={e.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{company}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{e.contact?.email ?? "—"}</td>
                      <td className="py-2 pr-3">{displayStep(e)}</td>
                      <td className="py-2 pr-3">
                        <Badge className={STATUS_COLOR[e.status] ?? "bg-slate-500"}>{e.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{Math.min(sentCountByEnrollment.get(e.id) ?? 0, 4)}/4</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {e.next_send_at ? new Date(e.next_send_at).toLocaleString("sv-SE") : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {e.last_sent_at ? new Date(e.last_sent_at).toLocaleString("sv-SE") : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {(e.status === "active" || e.status === "waiting_capacity") && (
                          <Button size="sm" variant="ghost" className="gap-1" onClick={() => stopEnrollment(e.id, "manual")}>
                            <StopCircle className="h-4 w-4" /> Ta ut
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t">
              <div className="text-xs text-muted-foreground">
                Sida {queuePage} av {queuePageCount} · Visar {pagedEnrollments.length} av {enrollments.length}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={queuePage <= 1}
                  onClick={() => setQueuePage((p) => Math.max(1, p - 1))}>
                  Föregående
                </Button>
                <Button size="sm" variant="outline" disabled={queuePage >= queuePageCount}
                  onClick={() => setQueuePage((p) => Math.min(queuePageCount, p + 1))}>
                  Nästa
                </Button>
              </div>
            </div>
          </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </Card>


      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Mail className="h-4 w-4" /> Senaste 5 skickade mail</h2>
        {recent.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Inget skickat än.</div>
        ) : (
          <div className="space-y-2">
            {recent.map((r) => {
              const c = contactById(r.contact_id);
              const company = c?.custom_fields?.company_name ?? r.recipient_email;
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/60 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{r.subject ?? "(ingen ämnesrad)"}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      → {company} · {r.recipient_email} · {new Date(r.sent_at).toLocaleString("sv-SE")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={r.status === "sent" ? "default" : "destructive"}>{r.status}</Badge>
                    <Badge variant="outline">
                      {!r.tracking_enabled
                        ? "ospårad"
                        : r.tracking_route === "custom"
                          ? "spårbar · egen domän"
                          : r.tracking_route === "supabase"
                            ? "spårbar · säker reserv"
                            : "spårbar · äldre okänd väg"}
                    </Badge>
                    {r.open_count > 0 && <Badge variant="outline">{r.open_count} öppning{r.open_count > 1 ? "ar" : ""}</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => setPreview(r)}><Eye className="h-4 w-4" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Prompts per steg</h2>
          <p className="text-xs text-muted-foreground">
            Ändringar sparas till sekvensen och används för nästa mail som skickas. Variabler:
            {" "}<code className="text-xs">{"{{company_name}}"}</code>,
            {" "}<code className="text-xs">{"{{demo_url}}"}</code>,
            {" "}<code className="text-xs">{"{{audit_weakness}}"}</code>,
            {" "}<code className="text-xs">{"{{website}}"}</code>,
            {" "}<code className="text-xs">{"{{category}}"}</code>.
          </p>
        </div>
        {sendNodes.map((n, i) => {
          const wait = waitNodes[i];
          const isDirty = !!dirty[n.id];
          return (
            <div key={n.id} className="border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Mail {i + 1}</div>
                  <div className="text-xs text-muted-foreground">
                    Modell: {n.config?.model ?? "gpt-4o-mini"} · Sender-domain: {n.config?.sender_domain ?? (language === "en" ? "foremp.eu" : "foremp.email")}
                    {wait && ` · väntar ${wait.config?.duration ?? "?"} ${wait.config?.unit ?? "days"} innan nästa`}
                  </div>
                </div>
                <Button size="sm" onClick={() => saveNode(n.id)} disabled={!isDirty || savingId === n.id} className="gap-1">
                  {savingId === n.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Spara
                </Button>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Ämnesrad-prompt</label>
                <Input
                  value={cfgVal(n, "subject_prompt")}
                  onChange={(e) => updateDirty(n.id, "subject_prompt", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Body-prompt</label>
                <Textarea
                  rows={9}
                  value={cfgVal(n, "prompt")}
                  onChange={(e) => updateDirty(n.id, "prompt", e.target.value)}
                />
              </div>
            </div>
          );
        })}
      </Card>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.subject ?? "(ingen ämnesrad)"}</DialogTitle>
            <DialogDescription>
              Till {preview?.recipient_email} · {preview && new Date(preview.sent_at).toLocaleString("sv-SE")}
            </DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap text-sm bg-muted/50 rounded-md p-4 max-h-[60vh] overflow-auto">
            {preview?.body ?? "(ingen body)"}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>Stäng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </Card>
  );
}
