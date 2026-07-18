import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

type Lead = {
  id: string;
  company_name: string;
  email: string | null;
  website: string | null;
  status: string;
  audit_score: number | null;
  demo_url: string | null;
  created_at: string;
};

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

export default function SiteLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [uploading, setUploading] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = async () => {
    const { data } = await supabase
      .from("site_leads")
      .select("id, company_name, email, website, status, audit_score, demo_url, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    setLeads((data ?? []) as Lead[]);
    const c: Record<string, number> = {};
    for (const l of data ?? []) c[l.status] = (c[l.status] ?? 0) + 1;
    setCounts(c);
  };

  useEffect(() => { load(); }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const csv = await f.text();
      const { data, error } = await supabase.functions.invoke("import-site-leads", {
        body: { csv },
      });
      if (error) throw error;
      toast({
        title: "Import klar",
        description: `${data?.inserted ?? 0} nya, ${data?.duplicates ?? 0} dubbletter, ${data?.skipped_no_contact ?? 0} utan kontakt.`,
      });
      await load();
    } catch (err) {
      toast({ title: "Import misslyckades", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
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
        <div>
          <label className="inline-block">
            <Input type="file" accept=".csv" onChange={onFile} disabled={uploading} className="hidden" id="csv-upload" />
            <Button asChild disabled={uploading}>
              <span>{uploading ? "Importerar..." : "Ladda upp CSV"}</span>
            </Button>
          </label>
          <input type="file" accept=".csv" onChange={onFile} disabled={uploading} className="ml-2 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(counts).map(([k, v]) => (
          <Card key={k} className="p-4">
            <div className="text-xs uppercase text-muted-foreground">{k}</div>
            <div className="text-2xl font-bold">{v}</div>
          </Card>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3">Företag</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Website</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Audit</th>
              <th className="text-left p-3">Demo</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-3 font-medium">{l.company_name}</td>
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
              </tr>
            ))}
            {leads.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Inga leads än. Ladda upp en CSV för att börja.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
