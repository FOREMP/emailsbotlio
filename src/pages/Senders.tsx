import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Mail, Send, Sparkles, Flame } from "lucide-react";
import { toast } from "sonner";

interface Sender {
  id: string;
  from_email: string;
  from_name: string;
  reply_to: string | null;
  is_active: boolean;
  daily_limit: number;
  warmup_enabled: boolean;
  warmup_started_at: string | null;
  warmup_target: number;
  followup_multiplier?: number;
}

interface SendingDomain {
  id: string;
  domain: string;
  brand: "foremp" | "botlio";
  reply_to_email: string;
  is_active: boolean;
  is_verified?: boolean;
}

const brandClass = (b: string) =>
  b === "foremp"
    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
    : "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30";

const Senders = () => {
  const { user } = useAuth();
  const [senders, setSenders] = useState<Sender[]>([]);
  const [domains, setDomains] = useState<SendingDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ from_name: "", local_part: "", domain: "" });
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testEmailFor, setTestEmailFor] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");

  const autoSeedTried = useRef(false);

  const load = async () => {
    setLoading(true);
    const [s, d] = await Promise.all([
      supabase.from("senders").select("*").order("from_email"),
      supabase.from("sending_domains").select("*").order("domain"),
    ]);
    if (s.error) toast.error(s.error.message);
    else setSenders(s.data || []);
    if (d.error) toast.error(d.error.message);
    else setDomains((d.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);

  const seedDefaults = async (silent = false) => {
    setSeeding(true);
    const { data, error } = await supabase.rpc("seed_default_senders");
    setSeeding(false);
    if (error) { if (!silent) toast.error(error.message); return; }
    if (!silent && (data ?? 0) > 0) toast.success(`${data} new sender(s) provisioned`);
    load();
  };

  // Auto-seed once on first visit if any default sender is missing
  useEffect(() => {
    if (!user || loading || autoSeedTried.current) return;
    if (domains.length === 0) return;
    const missing = domains.filter((x) => x.is_active).some((d) =>
      !senders.some((s) => s.from_email === `eric@${d.domain}`) ||
      !senders.some((s) => s.from_email === `isak@${d.domain}`)
    );
    if (missing) {
      autoSeedTried.current = true;
      seedDefaults(true);
    }
  }, [user, loading, domains, senders]);

  const domainBrand = (email: string) => {
    const dom = email.split("@")[1];
    return domains.find((d) => d.domain === dom);
  };

  const grouped = useMemo(() => {
    const groups: Record<string, Sender[]> = {};
    for (const s of senders) {
      const dom = s.from_email.split("@")[1] ?? "other";
      (groups[dom] ||= []).push(s);
    }
    return groups;
  }, [senders]);

  const create = async () => {
    if (!user) return;
    if (!form.from_name || !form.local_part || !form.domain) {
      toast.error("Name, local part and domain required");
      return;
    }
    const dom = domains.find((d) => d.domain === form.domain);
    if (!dom) return toast.error("Pick a valid domain");
    const fromEmail = `${form.local_part.trim().toLowerCase()}@${form.domain}`;
    setSaving(true);
    const { error } = await supabase.from("senders").insert({
      user_id: user.id,
      from_name: form.from_name,
      from_email: fromEmail,
      reply_to: dom.reply_to_email,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Sender added");
    setForm({ from_name: "", local_part: "", domain: "" });
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("senders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Sender removed");
    load();
  };

  const toggle = async (s: Sender) => {
    const { error } = await supabase.from("senders").update({ is_active: !s.is_active }).eq("id", s.id);
    if (error) return toast.error(error.message);
    load();
  };

  const sendTest = async (s: Sender) => {
    if (!testTo || !testTo.includes("@")) return toast.error("Enter a recipient email");
    setTestingId(s.id);
    const { data, error } = await supabase.functions.invoke("send-cold-email", {
      body: {
        user_id: user!.id,
        sender_id: s.id,
        contact: { email: testTo, first_name: "Test" },
        mode: "template",
        subject: `Routing test from ${s.from_email}`,
        body: `Hi — this is a routing test sent from ${s.from_name} <${s.from_email}>.\n\nReply to this email to confirm replies land in the right Zoho inbox.\n\n— ${s.from_name}`,
      },
    });
    setTestingId(null);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Test send failed");
      return;
    }
    toast.success(`Test queued via ${(data as any)?.sender_domain} → reply-to ${(data as any)?.reply_to}`);
    setTestEmailFor(null);
  };

  const updateSender = async (id: string, patch: Partial<Sender>) => {
    setSenders((prev) => prev.map((x) => x.id === id ? { ...x, ...patch } as Sender : x));
    const { error } = await supabase.from("senders").update(patch as any).eq("id", id);
    if (error) toast.error(error.message);
  };

  const startWarmupAll = async () => {
    if (senders.length === 0) return;
    const nowIso = new Date().toISOString();
    const ids = senders.filter((s) => s.is_active).map((s) => s.id);
    const { error } = await supabase
      .from("senders")
      .update({ warmup_enabled: true, warmup_started_at: nowIso, warmup_target: 50 })
      .in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`Warmup started on ${ids.length} senders. Day 1 cap: 5 emails each.`);
    load();
  };

  const todayQuota = (s: Sender) => {
    if (!s.warmup_enabled || !s.warmup_started_at) return s.daily_limit;
    const day = Math.max(1, Math.floor((Date.now() - new Date(s.warmup_started_at).getTime()) / 86_400_000) + 1);
    const ramp = day <= 6 ? day * 5 : 30 + (day - 6) * 10;
    return Math.min(s.daily_limit, s.warmup_target, Math.max(5, ramp));
  };
  const hasDomains = domains.length > 0;
  const allDefaultsPresent = useMemo(() => {
    if (!hasDomains) return true;
    for (const d of domains.filter((x) => x.is_active)) {
      const has = senders.some((s) => s.from_email === `eric@${d.domain}`) &&
                  senders.some((s) => s.from_email === `isak@${d.domain}`);
      if (!has) return false;
    }
    return true;
  }, [domains, senders, hasDomains]);

  return (
    <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Senders</h1>
            <p className="text-muted-foreground max-w-2xl">
              The identities your cold emails are sent from. Each sender is tied to a domain; replies are auto-routed to the brand's Zoho inbox.
            </p>
            {domains.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Provisioned: <span className="font-semibold text-foreground">{senders.length}</span> / {domains.filter((d) => d.is_active).length * 2} default senders
                {seeding && <span className="ml-2 text-primary">· auto-seeding…</span>}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {senders.some((s) => !s.warmup_enabled && s.is_active) && (
              <Button variant="outline" onClick={startWarmupAll}>
                <Flame className="h-4 w-4" /> Warm up all domains
              </Button>
            )}
            {!allDefaultsPresent && (
              <Button variant="outline" onClick={() => seedDefaults(false)} disabled={seeding}>
                <Sparkles className="h-4 w-4" /> {seeding ? "Seeding..." : "Auto-create Eric + Isak per domain"}
              </Button>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="gradient-primary border-0 text-primary-foreground"><Plus className="h-4 w-4" /> Add sender</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add a sender identity</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <Label>From name</Label>
                    <Input value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="Eric Wahlbom" />
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
                    <div>
                      <Label>Local part</Label>
                      <Input value={form.local_part} onChange={(e) => setForm({ ...form, local_part: e.target.value })} placeholder="eric" />
                    </div>
                    <div className="pb-2 text-muted-foreground">@</div>
                    <div>
                      <Label>Domain</Label>
                      <Select value={form.domain} onValueChange={(v) => setForm({ ...form, domain: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick domain" /></SelectTrigger>
                        <SelectContent>
                          {domains.filter((d) => d.is_active).map((d) => (
                            <SelectItem key={d.id} value={d.domain}>
                              {d.domain} <span className="text-muted-foreground ml-1">({d.brand})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Reply-to (auto)</Label>
                    <Input value={form.domain ? domains.find((d) => d.domain === form.domain)?.reply_to_email ?? "" : ""} readOnly className="bg-muted/40" />
                    <p className="text-xs text-muted-foreground mt-1">
                      Replies are forwarded to your brand inbox automatically — derived from the chosen domain.
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={create} disabled={saving} className="gradient-primary border-0 text-primary-foreground">
                    {saving ? "Saving..." : "Add sender"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : senders.length === 0 ? (
          <Card className="p-12 text-center">
            <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold mb-1">No senders yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {hasDomains ? "Click \"Auto-create Eric + Isak per domain\" to seed defaults across all 6 domains." : "Set up sender domains first."}
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([dom, list]) => {
              const d = domains.find((x) => x.domain === dom);
              return (
                <div key={dom}>
                  <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                    <h3 className="font-semibold">{dom}</h3>
                    {d && <Badge variant="outline" className={brandClass(d.brand)}>{d.brand}</Badge>}
                    {d && !d.is_verified && (
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                        Unverified domain — cannot send
                      </Badge>
                    )}
                    {d && <span className="text-xs text-muted-foreground">replies → {d.reply_to_email}</span>}
                  </div>
                  <div className="grid gap-2">
                    {list.map((s) => {
                      const db = domainBrand(s.from_email);
                      return (
                        <Card key={s.id} className="p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4 min-w-0">
                              <div className="h-10 w-10 rounded-full gradient-primary flex items-center justify-center text-primary-foreground font-semibold shrink-0">
                                {s.from_name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium truncate">{s.from_name}</div>
                                <div className="text-sm text-muted-foreground truncate">{s.from_email}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant={s.is_active ? "default" : "secondary"} className="cursor-pointer" onClick={() => toggle(s)}>
                                {s.is_active ? "Active" : "Paused"}
                              </Badge>
                              <Button variant="outline" size="sm" onClick={() => { setTestEmailFor(s.id); setTestTo(""); }}>
                                <Send className="h-3.5 w-3.5" /> Test send
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => remove(s.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end border-t pt-3">
                            <div>
                              <Label className="text-xs">Nya mail / dag</Label>
                              <Input
                                type="number"
                                min={1}
                                value={s.daily_limit}
                                onChange={(e) => updateSender(s.id, { daily_limit: Number(e.target.value) })}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Uppföljningar ×</Label>
                              <Input
                                type="number"
                                min={1}
                                value={s.followup_multiplier ?? 3}
                                onChange={(e) => updateSender(s.id, { followup_multiplier: Number(e.target.value) })}
                              />
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {s.daily_limit} nya + {s.daily_limit * (s.followup_multiplier ?? 3)} uppföljningar per dag
                              </p>
                            </div>
                            <div>
                              <Label className="text-xs">Today's quota</Label>
                              <div className="h-9 px-3 flex items-center rounded-md border bg-muted/40 text-sm">
                                {todayQuota(s)} {s.warmup_enabled && <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400">warming…</span>}
                              </div>
                            </div>

                            {!s.warmup_enabled ? (
                              <Button size="sm" variant="outline" onClick={() => updateSender(s.id, { warmup_enabled: true, warmup_started_at: new Date().toISOString(), warmup_target: 50 })}>
                                <Flame className="h-3.5 w-3.5" /> Warm up
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => updateSender(s.id, { warmup_enabled: false, warmup_started_at: null })}>
                                Stop warmup
                              </Button>
                            )}
                          </div>
                          {testEmailFor === s.id && (
                            <div className="mt-3 flex gap-2 items-end border-t pt-3">
                              <div className="flex-1">
                                <Label className="text-xs">Recipient (your inbox)</Label>
                                <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
                              </div>
                              <Button size="sm" onClick={() => sendTest(s)} disabled={testingId === s.id}>
                                {testingId === s.id ? "Sending..." : "Send test"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setTestEmailFor(null)}>Cancel</Button>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
};

export default Senders;
