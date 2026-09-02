// "Att besluta" — leads the audit judged as needing a new site.
// You decide per lead: park it, build + send directly, or build + review first.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Check, Send, Eye, Loader2 } from "lucide-react";
import { auditScoreLabel } from "@/lib/site-audit-score";

type TriageLead = {
  id: string;
  company_name: string;
  language: string | null;
  email: string | null;
  website: string | null;
  category: string | null;
  niche: string | null;
  audit_score: number | null;
  audit_reason: string | null;
  audit_details: {
    weaknesses?: string[];
    structural?: string[];
    cosmetic?: string[];
    borderline?: boolean;
  } | null;

};

const PAGE = 25;

interface Props {
  languageFilter: string;
  nicheFilter: string;
  onChanged: () => void;
  /** Bumped by the parent when leads change elsewhere, to force a refresh. */
  refreshKey?: number;
}

export default function TriageQueue({ languageFilter, nicheFilter, onChanged, refreshKey }: Props) {
  const [rows, setRows] = useState<TriageLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from("site_leads")
      .select("id, company_name, language, email, website, category, niche, audit_score, audit_reason, audit_details", { count: "exact" })
      .eq("status", "needs_triage")
      .order("audit_score", { ascending: true, nullsFirst: false })
      .limit(PAGE);
    if (languageFilter !== "all") query = query.eq("language", languageFilter);
    if (nicheFilter !== "all") query = query.eq("niche", nicheFilter);
    const { data, error, count } = await query;
    setLoading(false);
    if (error) {
      toast({ title: "Kunde inte ladda triage-kön", description: error.message, variant: "destructive" });
      return;
    }
    setRows((data ?? []) as TriageLead[]);
    setTotal(count ?? 0);
  }, [languageFilter, nicheFilter]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const decide = async (lead: TriageLead, decision: "park" | "auto" | "review") => {
    if (decision === "auto" && !lead.email) {
      toast({ title: "Saknar email", description: "Leaden har ingen mailadress — kan inte skickas automatiskt.", variant: "destructive" });
      return;
    }
    setBusyId(lead.id);
    const patch =
      decision === "park"
        ? { status: "site_good_enough", auto_send: false, triaged_at: new Date().toISOString() }
        : { status: "needs_site", auto_send: decision === "auto", triaged_at: new Date().toISOString() };
    const { error } = await supabase.from("site_leads").update(patch).eq("id", lead.id);
    setBusyId(null);
    if (error) {
      toast({ title: "Kunde inte spara beslut", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title:
        decision === "park"
          ? "Parkerad — ingen hemsida byggs"
          : decision === "auto"
            ? "Köad: byggs och skickas direkt"
            : "Köad: byggs, du granskar innan utskick",
      description: lead.company_name,
    });
    setRows((prev) => prev.filter((r) => r.id !== lead.id));
    setTotal((t) => Math.max(0, t - 1));
    onChanged();
  };

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-2 p-3 border-b bg-muted/40">
        <h2 className="text-sm font-semibold">Att besluta</h2>
        <Badge className="bg-amber-500">{total}</Badge>
        <p className="text-xs text-muted-foreground ml-2">
          Högst säljpotential först. 10 = starkaste möjligheten för en ny hemsida, 1 = nuvarande sida är redan mycket bra.
        </p>

        <Button size="sm" variant="ghost" className="ml-auto" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Uppdatera"}
        </Button>
      </div>

      {rows.length === 0 && !loading && (
        <div className="p-6 text-center text-sm text-muted-foreground">Inget att besluta just nu.</div>
      )}

      <div className="divide-y">
        {rows.map((l) => (
          <div key={l.id} className="p-3 flex flex-wrap items-start gap-3">
            <div className="min-w-[220px] flex-1">
              <div className="font-medium flex items-center gap-2 flex-wrap">
                {l.company_name}
                <Badge variant="outline">{(l.language ?? "sv").toUpperCase()}</Badge>
                <Badge className="bg-slate-700">Säljpotential {auditScoreLabel(l.audit_score)}</Badge>
                {l.audit_score != null && (
                  <Badge variant="outline">Nuvarande sajtkvalitet {l.audit_score}/10</Badge>
                )}
                {l.audit_details?.borderline && (
                  <Badge className="bg-amber-500">Gränsfall</Badge>
                )}
                {(Array.isArray(l.audit_details?.structural) || Array.isArray(l.audit_details?.cosmetic))
                  && !l.audit_details?.structural?.length && (
                  <Badge variant="outline" className="text-muted-foreground">Inga riktiga brister</Badge>
                )}
                {!Array.isArray(l.audit_details?.structural)
                  && !Array.isArray(l.audit_details?.cosmetic)
                  && !!l.audit_details?.weaknesses?.length && (
                    <Badge variant="outline" className="text-amber-700">Äldre audit – brister ej klassificerade</Badge>
                  )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {l.category ?? l.niche ?? "—"} · {l.email ?? "ingen email"}
                {l.website && (
                  <>
                    {" · "}
                    <a href={l.website} target="_blank" rel="noreferrer" className="underline">Nuvarande sajt</a>
                  </>
                )}
              </div>
              {l.audit_reason && <p className="text-xs mt-1">{l.audit_reason}</p>}
              {!!l.audit_details?.structural?.length && (
                <ul className="text-xs text-destructive list-disc pl-4 mt-1">
                  {l.audit_details.structural.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {!!l.audit_details?.cosmetic?.length && (
                <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1">
                  {l.audit_details.cosmetic.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {!l.audit_details?.structural?.length && !l.audit_details?.cosmetic?.length
                && !!l.audit_details?.weaknesses?.length && (
                <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1">
                  {l.audit_details.weaknesses.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}

            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1" disabled={busyId === l.id}
                onClick={() => decide(l, "park")}>
                <Check className="h-4 w-4" /> Bra nog
              </Button>
              <Button size="sm" variant="default" className="gap-1" disabled={busyId === l.id}
                onClick={() => decide(l, "auto")}>
                <Send className="h-4 w-4" /> Bygg + skicka direkt
              </Button>
              <Button size="sm" variant="secondary" className="gap-1" disabled={busyId === l.id}
                onClick={() => decide(l, "review")}>
                <Eye className="h-4 w-4" /> Bygg + jag granskar
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
