import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, MailOpen, Phone, RefreshCw, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";

type CallStatus = "not_called" | "called" | "no_answer" | "not_interested" | "follow_up" | "interested" | "converted";

type CallLead = {
  lead_id: string;
  company_name: string;
  language: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  demo_url: string | null;
  lead_status: string;
  call_status: CallStatus;
  call_note: string | null;
  called_at: string | null;
  total_opens: number;
  max_single_email_opens: number;
  opened_email_count: number;
  sent_email_count: number;
  last_opened_at: string | null;
  last_sent_at: string | null;
  latest_subject: string | null;
  has_reply: boolean;
  total_count: number;
};

const PAGE_SIZE = 25;

const outcomeLabels: Record<CallStatus, string> = {
  not_called: "Inte ringd",
  called: "Ringd",
  no_answer: "Inget svar",
  not_interested: "Inte intresserad",
  follow_up: "Följ upp",
  interested: "Intresserad",
  converted: "Blev kund",
};

function externalUrl(value: string | null) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export default function CallLeads() {
  const [language, setLanguage] = useState<"all" | "sv" | "en">("all");
  const [minOpens, setMinOpens] = useState("3");
  const [recency, setRecency] = useState("30");
  const [onlyUncalled, setOnlyUncalled] = useState(true);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CallLead[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const total = rows[0]?.total_count ?? 0;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_call_lead_queue", {
      p_language: language === "all" ? null : language,
      p_min_opens: Number(minOpens),
      p_only_uncalled: onlyUncalled,
      p_since: recency === "all" ? null : new Date(Date.now() - Number(recency) * 86_400_000).toISOString(),
      p_limit: PAGE_SIZE,
      p_offset: page * PAGE_SIZE,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Kunde inte ladda ringlistan", description: error.message, variant: "destructive" });
      return;
    }
    const next = (data ?? []) as CallLead[];
    setRows(next);
    setNotes(Object.fromEntries(next.map((row) => [row.lead_id, row.call_note ?? ""])));
  }, [language, minOpens, onlyUncalled, page, recency]);

  useEffect(() => { void load(); }, [load]);

  const shownFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const shownTo = Math.min((page + 1) * PAGE_SIZE, total);
  const strongCount = useMemo(() => rows.filter((row) => row.max_single_email_opens >= 5).length, [rows]);

  async function updateLead(row: CallLead, status: CallStatus, note: string) {
    setSaving(row.lead_id);
    const calledAt = status === "not_called" ? null : row.called_at ?? new Date().toISOString();
    const { error } = await supabase
      .from("site_leads")
      .update({ call_status: status, call_note: note.trim() || null, called_at: calledAt })
      .eq("id", row.lead_id);
    setSaving(null);
    if (error) {
      toast({ title: "Kunde inte spara samtalet", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: status === "not_called" ? "Markerad som inte ringd" : "Samtalet sparades" });
    await load();
  }

  function changeLocalStatus(leadId: string, status: CallStatus) {
    setRows((current) => current.map((row) => row.lead_id === leadId ? { ...row, call_status: status } : row));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold">Ringlista</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Prioriterar företag som öppnat samma mejl flera gånger. Det är en intressesignal, men kan även påverkas av mottagarens bildproxy.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading} aria-label="Uppdatera ringlistan">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5"><p className="text-sm text-muted-foreground">Matchande leads</p><p className="mt-1 text-3xl font-semibold">{total}</p></Card>
        <Card className="p-5"><p className="text-sm text-muted-foreground">Visas nu</p><p className="mt-1 text-3xl font-semibold">{rows.length}</p></Card>
        <Card className="p-5"><p className="text-sm text-muted-foreground">5+ öppningar på samma mejl</p><p className="mt-1 text-3xl font-semibold">{strongCount}</p></Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Språk</p>
            <Select value={language} onValueChange={(value) => { setLanguage(value as typeof language); setPage(0); }}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Alla språk</SelectItem><SelectItem value="sv">Svenska</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Minst öppningar på samma mejl</p>
            <Select value={minOpens} onValueChange={(value) => { setMinOpens(value); setPage(0); }}>
              <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="2">2 öppningar</SelectItem><SelectItem value="3">3 öppningar</SelectItem><SelectItem value="5">5 öppningar</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Senast öppnat</p>
            <Select value={recency} onValueChange={(value) => { setRecency(value); setPage(0); }}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="30">30 dagar</SelectItem><SelectItem value="90">90 dagar</SelectItem><SelectItem value="all">Hela tiden</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 pb-2">
            <Switch checked={onlyUncalled} onCheckedChange={(checked) => { setOnlyUncalled(checked); setPage(0); }} />
            <span className="text-sm">Visa endast inte ringda</span>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-semibold">Prioriterade samtal</h2>
          <p className="mt-1 text-sm text-muted-foreground">Visar {shownFrom}–{shownTo} av {total}. Högsta antal öppningar på ett enskilt mejl visas först.</p>
        </div>
        <div className="divide-y">
          {rows.map((row) => {
            const website = externalUrl(row.website);
            const demo = externalUrl(row.demo_url);
            const isCalled = row.call_status !== "not_called";
            return (
              <div key={row.lead_id} className="space-y-4 p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{row.company_name}</h3>
                      <Badge variant="outline">{row.language.toUpperCase()}</Badge>
                      {row.has_reply && <Badge>Har svarat</Badge>}
                      <Badge variant={row.max_single_email_opens >= 5 ? "default" : "secondary"}>
                        <MailOpen className="mr-1 h-3.5 w-3.5" />{row.max_single_email_opens}× samma mejl
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <a className="font-medium text-foreground hover:underline" href={`tel:${row.phone}`}>{row.phone}</a>
                      <span>{row.email}</span>
                      <span>{row.total_opens} öppningar totalt över {row.opened_email_count} mejl</span>
                      {row.last_opened_at && <span>Senast öppnat {new Date(row.last_opened_at).toLocaleString("sv-SE")}</span>}
                    </div>
                    {row.latest_subject && <p className="text-sm text-muted-foreground">Senaste ämne: {row.latest_subject}</p>}
                    <div className="flex flex-wrap gap-3 text-sm">
                      {website && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={website} target="_blank" rel="noreferrer">Nuvarande sida <ExternalLink className="h-3.5 w-3.5" /></a>}
                      {demo && <a className="inline-flex items-center gap-1 text-primary hover:underline" href={demo} target="_blank" rel="noreferrer">Demo <ExternalLink className="h-3.5 w-3.5" /></a>}
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm font-medium">
                    <Checkbox
                      checked={isCalled}
                      disabled={saving === row.lead_id}
                      onCheckedChange={(checked) => void updateLead(row, checked ? "called" : "not_called", notes[row.lead_id] ?? "")}
                    />
                    Jag har ringt
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-[190px_1fr_auto]">
                  <Select value={row.call_status} onValueChange={(value) => changeLocalStatus(row.lead_id, value as CallStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(outcomeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input
                    value={notes[row.lead_id] ?? ""}
                    onChange={(event) => setNotes((current) => ({ ...current, [row.lead_id]: event.target.value }))}
                    placeholder="Kort notering, t.ex. ring igen torsdag eller inte intresserad"
                    maxLength={500}
                  />
                  <Button onClick={() => void updateLead(row, row.call_status, notes[row.lead_id] ?? "")} disabled={saving === row.lead_id}>
                    {saving === row.lead_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Spara
                  </Button>
                </div>
              </div>
            );
          })}
          {!loading && rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Inga leads matchar filtret.</p>}
          {loading && <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Laddar ringlistan…</div>}
        </div>
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t p-4">
            <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>Föregående</Button>
            <span className="text-sm text-muted-foreground">Sida {page + 1} av {Math.ceil(total / PAGE_SIZE)}</span>
            <Button variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>Nästa</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
