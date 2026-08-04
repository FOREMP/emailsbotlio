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
import { computeDailySeries, computeKpis, type SentEmailRow } from "@/hooks/useAnalytics";

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
  id: string; sent_at: string; subject: string | null; body: string | null;
  recipient_email: string; status: string; open_count: number; opened_at: string | null;
  contact_id: string | null;
};

const STEP_LABEL: Record<number, string> = { 1: "Mail 1", 2: "Mail 2", 3: "Mail 3", 4: "Mail 4" };
const STATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-500",
  waiting_capacity: "bg-amber-500",
  completed: "bg-slate-500",
  stopped: "bg-red-500",
  unsubscribed: "bg-red-500",
  failed: "bg-red-600",
};

export default function SiteOutreach() {
  const [seq, setSeq] = useState<Seq | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollRow[]>([]);
  const [recent, setRecent] = useState<SentRow[]>([]);
  const [statsRows, setStatsRows] = useState<SentEmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<SentRow | null>(null);
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingLimit, setSavingLimit] = useState(false);

  const load = useCallback(async () => {
    // Internal tool — sequence is shared across all logged-in operators.
    const { data: s } = await supabase
      .from("sequences")
      .select("id, contact_list_id")
      .eq("name", "Site Demo Outreach")
      .maybeSingle();
    if (!s?.id) { setLoading(false); return; }
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

    const enrIds = enrs.map((e: any) => e.id);
    const { data: sent } = enrIds.length
      ? await supabase
          .from("sent_emails")
          .select("id, sent_at, subject, body, recipient_email, status, open_count, opened_at, contact_id")
          .in("enrollment_id", enrIds)
          .order("sent_at", { ascending: false })
          .limit(5)
      : { data: [] as SentRow[] };

    // Statistik: hämta ALLA enrollment-ids för sekvensen (lätt query) och sedan
    // sent_emails senaste 30 dagarna, chunkat för att undvika 414-URL-längd.
    const { data: allEnrIdsRaw } = await supabase
      .from("enrollments").select("id").eq("sequence_id", s.id);
    const allEnrIds = (allEnrIdsRaw ?? []).map((r: any) => r.id);
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const stats: SentEmailRow[] = [];
    for (let i = 0; i < allEnrIds.length; i += 200) {
      const chunk = allEnrIds.slice(i, i + 200);
      const { data } = await supabase
        .from("sent_emails")
        .select("id, recipient_email, status, sent_at, opened_at, replied_at, sender_id, enrollment_id, subject")
        .in("enrollment_id", chunk)
        .gte("sent_at", since30)
        .limit(2000);
      if (data) stats.push(...(data as SentEmailRow[]));
    }

    setNodes((ns ?? []) as Node[]);
    setEnrollments(enrsWithContact as any);
    setRecent((sent ?? []) as SentRow[]);
    setStatsRows(stats);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const sendNodes = useMemo(
    () => nodes.filter((n) => n.node_type === "send_email").sort((a, b) => a.position_y - b.position_y),
    [nodes],
  );
  const waitNodes = useMemo(
    () => nodes.filter((n) => n.node_type === "wait").sort((a, b) => a.position_y - b.position_y),
    [nodes],
  );
  const cfgVal = (node: Node, key: string) => (dirty[node.id]?.[key] ?? node.config?.[key] ?? "");
  const throttleNodes = useMemo(
    () => nodes.filter((n) => n.node_type === "throttle").sort((a, b) => a.position_y - b.position_y),
    [nodes],
  );
  const dailyLimitNode = throttleNodes[0] ?? null;
  const dailyLimit = Number(dailyLimitNode ? cfgVal(dailyLimitNode, "max_per_day") : 16) || 16;

  const counts = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const active = enrollments.filter((e) => e.status === "active" || e.status === "waiting_capacity").length;
    const waitingRows = enrollments.filter((e) => e.status === "waiting_capacity");
    const waiting = waitingRows.length;
    const waitingFirst = waitingRows.filter((e) => !e.last_sent_at).length;
    const waitingFollowup = waiting - waitingFirst;
    const completed = enrollments.filter((e) => e.status === "completed").length;
    const stopped = enrollments.filter((e) => e.status === "stopped" || e.status === "unsubscribed").length;
    const newLast24h = enrollments.filter((e) => e.created_at && new Date(e.created_at).getTime() >= dayAgo).length;

    // Dagens utskick uppdelat på förstamail och uppföljningar.
    const firstSendAt = new Map<string, number>();
    for (const r of statsRows) {
      const eid = (r as any).enrollment_id as string | null;
      if (!eid) continue;
      const t = new Date(r.sent_at).getTime();
      const prev = firstSendAt.get(eid);
      if (prev === undefined || t < prev) firstSendAt.set(eid, t);
    }
    let sentFirstToday = 0;
    let sentFollowupToday = 0;
    for (const r of statsRows) {
      const t = new Date(r.sent_at).getTime();
      if (t < today.getTime()) continue;
      const eid = (r as any).enrollment_id as string | null;
      const isFollowup = !!eid && (firstSendAt.get(eid) ?? t) < t;
      if (isFollowup) sentFollowupToday++; else sentFirstToday++;
    }
    return {
      active, waiting, waitingFirst, waitingFollowup, completed, stopped,
      newLast24h, sentFirstToday, sentFollowupToday,
      sentToday: sentFirstToday + sentFollowupToday,
    };
  }, [enrollments, statsRows]);


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
    setDirty((d) => { const c = { ...d }; delete c[nodeId]; return c; });
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
        const { data: forempSenders } = await supabase
          .from("senders")
          .select("id")
          .eq("user_id", uid)
          .eq("is_active", true)
          .ilike("from_email", "%@foremp.email");
        const perSender = Math.max(1, Math.ceil(nextLimit / Math.max((forempSenders ?? []).length, 1)));
        for (const s of forempSenders ?? []) {
          const { error } = await supabase.from("senders").update({ daily_limit: perSender }).eq("id", s.id);
          if (error) throw error;
        }
      }

      setDirty((d) => {
        const c = { ...d };
        for (const n of throttleNodes) delete c[n.id];
        return c;
      });
      toast({ title: "Daglig gräns sparad", description: `${nextLimit} mail/dag totalt, inklusive follow-ups.` });
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

  const contactById = (id: string | null) => enrollments.find((e) => e.contact?.id === id)?.contact ?? null;

  if (loading) return <div className="text-sm text-muted-foreground">Laddar…</div>;

  if (!seq) {
    return (
      <Card className="p-8 text-center space-y-2">
        <h2 className="text-lg font-semibold">Site Demo Outreach saknas</h2>
        <p className="text-sm text-muted-foreground">Kör seed-migrationen för att skapa sekvensen.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Demo Outreach</h1>
        <p className="text-sm text-muted-foreground">
          4-mails svensk sekvens från @foremp.email — <strong>skickas endast måndag–fredag 09:00 Stockholm-tid</strong>.
          Fylls på automatiskt när du godkänner demos i Approvals (kontakt, hemsidelänk och audit-info följer med).
        </p>
      </div>

      <Card className="p-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Gauge className="h-4 w-4" /> Daglig utskicksgräns</h2>
          <p className="text-xs text-muted-foreground">
            Räknar endast <strong>nya första mail</strong> per dag. Follow-ups skickas alltid ovanpå detta.
            Totalen delas jämnt mellan aktiva @foremp.email-sender (t.ex. 10 = 5 per sender).
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Aktiva" value={counts.active} />
        <StatCard label="Väntar på första mail" value={counts.waitingFirst} />
        <StatCard label="Väntar på uppföljning" value={counts.waitingFollowup} />
        <StatCard label="Nya i kön (24h)" value={counts.newLast24h} />
        <StatCard label={`Nya mail i dag (av ${dailyLimit})`} value={counts.sentFirstToday} />
        <StatCard label={`Uppföljningar i dag (av ${dailyLimit * 3})`} value={counts.sentFollowupToday} />
        <StatCard label="Klara" value={counts.completed} />
        <StatCard label="Stoppade" value={counts.stopped} />

      </div>

      {/* Statistik — samma graf som Analytics, men filtrerad på denna sekvens */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Statistik (senaste 30 dagar)</h2>
            <p className="text-xs text-muted-foreground">Skickade, öppnade och besvarade mail per dag för Site Demo Outreach.</p>
          </div>
          {(() => {
            const k = computeKpis(statsRows);
            return (
              <div className="flex gap-4 text-xs">
                <div><div className="text-muted-foreground">Skickade</div><div className="text-base font-semibold">{k.sent}</div></div>
                <div><div className="text-muted-foreground">Öppnade</div><div className="text-base font-semibold">{k.opened} ({Math.round(k.openRate * 100)}%)</div></div>
                <div><div className="text-muted-foreground">Besvarade</div><div className="text-base font-semibold">{k.replied}</div></div>
                <div><div className="text-muted-foreground">Bounces</div><div className="text-base font-semibold">{k.bounced}</div></div>
              </div>
            );
          })()}
        </div>
        <VolumeTrendChart data={computeDailySeries(statsRows, 30)} />
      </Card>


      {/* Enrollment queue */}
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
                  <th className="py-2 pr-3">Steg</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Nästa sändning</th>
                  <th className="py-2 pr-3">Senast skickat</th>
                  <th className="py-2 pr-3 text-right">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => {
                  const company = e.contact?.custom_fields?.company_name ?? "—";
                  return (
                    <tr key={e.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{company}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{e.contact?.email ?? "—"}</td>
                      <td className="py-2 pr-3">{STEP_LABEL[e.current_step] ?? `step ${e.current_step}`}</td>
                      <td className="py-2 pr-3">
                        <Badge className={STATUS_COLOR[e.status] ?? "bg-slate-500"}>{e.status}</Badge>
                      </td>
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
          </div>
        )}
      </Card>

      {/* Recent 5 sent mails */}
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
                    {r.open_count > 0 && <Badge variant="outline">{r.open_count} öppning{r.open_count > 1 ? "ar" : ""}</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => setPreview(r)}><Eye className="h-4 w-4" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Prompt editor */}
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
          const wait = waitNodes[i]; // wait AFTER this send (if any)
          const isDirty = !!dirty[n.id];
          return (
            <div key={n.id} className="border rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">Mail {i + 1}</div>
                  <div className="text-xs text-muted-foreground">
                    Modell: {n.config?.model ?? "gpt-4.1-mini"} · Sender-domain: {n.config?.sender_domain ?? "foremp.email"}
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
