import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FileSpreadsheet, Upload, Pencil, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";

type Lead = {
  id: string;
  company_name: string;
  email: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  category: string | null;
  rating: number | null;
  reviews_count: number | null;
  review_snippets: string[] | null;
  feedback: string | null;
  status: string;
  audit_score: number | null;
  demo_url: string | null;
  created_at: string;
};

type ImportRole =
  | "skip"
  | "company_name"
  | "website"
  | "email"
  | "phone"
  | "address"
  | "category"
  | "rating"
  | "reviews_count"
  | "review";

type ParsedData = {
  headers: string[];
  rows: Record<string, string>[];
  fileName: string;
  fileSize: number;
};

const BATCH_SIZE = 20;

const ROLE_LABELS: Record<ImportRole, string> = {
  skip: "Skippa",
  company_name: "Företag",
  website: "Hemsida",
  email: "Email",
  phone: "Telefon",
  address: "Adress",
  category: "Kategori",
  rating: "Rating",
  reviews_count: "Antal reviews",
  review: "Review-text",
};

const STATUS_OPTIONS = [
  "pending_audit",
  "auditing",
  "site_good_enough",
  "needs_site",
  "generating",
  "awaiting_approval",
  "approved",
  "skipped_no_contact",
  "failed",
];

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

const NICHE_OPTIONS: { value: string; label: string }[] = [
  { value: "auto_workshop", label: "Bilverkstad / mekaniker" },
  { value: "hair_salon", label: "Frisörsalong" },
];

export default function SiteLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [uploading, setUploading] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportRole>>({});
  const [niche, setNiche] = useState<string>("auto_workshop");
  const [progress, setProgress] = useState(0);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("site_leads")
      .select("id, company_name, email, website, phone, address, category, rating, reviews_count, review_snippets, feedback, status, audit_score, demo_url, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    setLeads((data ?? []) as Lead[]);
    const c: Record<string, number> = {};
    for (const l of data ?? []) c[l.status] = (c[l.status] ?? 0) + 1;
    setCounts(c);
  };

  useEffect(() => { load(); }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = await parseFile(f);
      setParsed(data);
      setMapping(autoDetectMapping(data.headers));
    } catch (err) {
      toast({ title: "Kunde inte läsa filen", description: (err as Error).message, variant: "destructive" });
      e.target.value = "";
    }
  };

  const startImport = async () => {
    if (!parsed) return;
    if (!Object.values(mapping).includes("company_name")) {
      toast({ title: "Välj företagskolumn", description: "Mappa en kolumn till Företag innan import.", variant: "destructive" });
      return;
    }

    setUploading(true);
    setProgress(0);
    const totals = { inserted: 0, duplicates: 0, invalid: 0, skipped_no_contact: 0, failed_batches: 0, total: 0 };
    try {
      for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
        const rows = parsed.rows.slice(i, i + BATCH_SIZE).map((row) => slimRow(row, mapping));
        const { data, error } = await supabase.functions.invoke("import-site-leads", {
          body: { rows, mapping, niche },
        });
        if (error) {
          totals.failed_batches += 1;
        } else {
          totals.inserted += data?.inserted ?? 0;
          totals.duplicates += data?.duplicates ?? 0;
          totals.invalid += data?.invalid ?? 0;
          totals.skipped_no_contact += data?.skipped_no_contact ?? 0;
          totals.total += data?.total ?? 0;
        }
        setProgress(Math.min(parsed.rows.length, i + BATCH_SIZE));
      }

      toast({
        title: "Import klar",
        description: `${totals.inserted} nya, ${totals.duplicates} dubbletter, ${totals.skipped_no_contact} utan både email + hemsida.${totals.failed_batches ? ` ${totals.failed_batches} batchar misslyckades.` : ""}`,
      });
      setParsed(null);
      setProgress(0);
      await load();
    } catch (err) {
      toast({ title: "Import misslyckades", description: (err as Error).message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const website = normalizeUrl(editing.website);
      const email = normalizeEmail(editing.email);
      const domain = extractDomain(website) || (email ? email.split("@")[1] : null);
      const snippets = (editing.review_snippets ?? [])
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
        .slice(0, 5);

      // Auto-adjust status only when it's a contact-driven bucket.
      let status = editing.status;
      const hasContact = !!website && !!email;
      if (status === "skipped_no_contact" && hasContact) status = "pending_audit";
      if (status === "pending_audit" && !hasContact) status = "skipped_no_contact";

      const { error } = await supabase
        .from("site_leads")
        .update({
          company_name: editing.company_name.trim(),
          company_name_normalized: normalizeName(editing.company_name),
          website,
          email,
          domain,
          domain_normalized: domain ? domain.toLowerCase() : null,
          phone: editing.phone || null,
          address: editing.address || null,
          category: editing.category || null,
          rating: editing.rating,
          reviews_count: editing.reviews_count,
          review_snippets: snippets.length ? snippets : null,
          feedback: editing.feedback || null,
          status,
        })
        .eq("id", editing.id);
      if (error) throw error;
      toast({ title: "Sparat", description: `${editing.company_name} uppdaterad.` });
      setEditing(null);
      await load();
    } catch (err) {
      toast({ title: "Kunde inte spara", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteLead = async () => {
    if (!editing) return;
    if (!confirm(`Radera ${editing.company_name}? Detta går inte att ångra.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("site_leads").delete().eq("id", editing.id);
      if (error) throw error;
      toast({ title: "Raderad" });
      setEditing(null);
      await load();
    } catch (err) {
      toast({ title: "Kunde inte radera", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
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
        <label className="inline-block">
          <Input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} disabled={uploading} className="hidden" />
          <Button asChild disabled={uploading}>
            <span className="gap-2 inline-flex items-center"><Upload className="h-4 w-4" /> Ladda upp fil</span>
          </Button>
        </label>
      </div>

      {parsed && (
        <Card className="p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{parsed.fileName}</span>
            <span className="text-muted-foreground">— {parsed.rows.length} rader, {parsed.headers.length} kolumner</span>
            {uploading && <span className="text-muted-foreground">Importerar {progress}/{parsed.rows.length}</span>}
            <Button variant="ghost" size="sm" className="ml-auto" disabled={uploading} onClick={() => setParsed(null)}>Avbryt</Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {parsed.headers.map((header) => (
              <div key={header} className="grid gap-1">
                <Label className="text-xs font-mono truncate" title={header}>{header}</Label>
                <Select
                  value={mapping[header] ?? "skip"}
                  onValueChange={(value) => setMapping((prev) => ({ ...prev, [header]: value as ImportRole }))}
                  disabled={uploading}
                >
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABELS) as ImportRole[]).map((role) => (
                      <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={uploading} onClick={() => setMapping(autoDetectMapping(parsed.headers))}>Auto-mappa</Button>
            <Button disabled={uploading} onClick={startImport}>{uploading ? "Importerar..." : `Importera ${parsed.rows.length} leads`}</Button>
          </div>
        </Card>
      )}

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
              <th className="text-right p-3"></th>
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
                <td className="p-3 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing({ ...l, review_snippets: l.review_snippets ?? [] })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Inga leads än. Ladda upp en CSV för att börja.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Redigera lead</DialogTitle>
            <DialogDescription>Uppdatera all info om företaget. Status justeras automatiskt om email/hemsida saknas.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-4">
              <Field label="Företag">
                <Input value={editing.company_name} onChange={(e) => setEditing({ ...editing, company_name: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email"><Input value={editing.email ?? ""} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
                <Field label="Hemsida"><Input value={editing.website ?? ""} onChange={(e) => setEditing({ ...editing, website: e.target.value })} /></Field>
                <Field label="Telefon"><Input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
                <Field label="Kategori"><Input value={editing.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></Field>
                <Field label="Rating"><Input type="number" step="0.1" value={editing.rating ?? ""} onChange={(e) => setEditing({ ...editing, rating: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
                <Field label="Antal reviews"><Input type="number" value={editing.reviews_count ?? ""} onChange={(e) => setEditing({ ...editing, reviews_count: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              </div>
              <Field label="Adress"><Input value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></Field>
              <Field label="Reviews (en per rad, max 5)">
                <Textarea rows={5} value={(editing.review_snippets ?? []).join("\n")} onChange={(e) => setEditing({ ...editing, review_snippets: e.target.value.split("\n") })} />
              </Field>
              <Field label="Feedback / interna anteckningar">
                <Textarea rows={3} value={editing.feedback ?? ""} onChange={(e) => setEditing({ ...editing, feedback: e.target.value })} />
              </Field>
              <Field label="Status">
                <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          )}
          <DialogFooter className="flex sm:justify-between gap-2">
            <Button variant="destructive" onClick={deleteLead} disabled={saving} className="gap-2">
              <Trash2 className="h-4 w-4" /> Radera
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>Avbryt</Button>
              <Button onClick={saveEdit} disabled={saving}>{saving ? "Sparar..." : "Spara"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function autoDetectMapping(headers: string[]): Record<string, ImportRole> {
  const mapping: Record<string, ImportRole> = {};
  const used = new Set<ImportRole>();
  for (const header of headers) {
    const h = header.toLowerCase().trim();
    const once = (role: ImportRole) => {
      if (used.has(role)) return false;
      mapping[header] = role;
      used.add(role);
      return true;
    };

    if (/lat|lng|lon|coord|plus_code|place_id|cid|kml|fid|panorama|image|photo|thumb|logo|icon|hour|open|close|time|schedule/i.test(h)) mapping[header] = "skip";
    else if (/^(name|title)$|company|business|företag|firma/i.test(h) && once("company_name")) continue;
    else if (/email|e-mail|mail/i.test(h) && once("email")) continue;
    else if (/website|web site|site|domain|homepage|url|hemsida|webb/i.test(h) && once("website")) continue;
    else if (/phone|tel|mobile|telefon/i.test(h) && once("phone")) continue;
    else if (/address|street|city|postal|zip|region|country|adress/i.test(h) && once("address")) continue;
    else if (/category|type|industry|kategori/i.test(h) && once("category")) continue;
    else if (/reviews?_count|review.*number|number.*review|antal.*review/i.test(h) && once("reviews_count")) continue;
    else if (/rating|score|stars|betyg/i.test(h) && once("rating")) continue;
    else if (/review|recension|comment|feedback/i.test(h)) mapping[header] = "review";
    else mapping[header] = "skip";
  }
  return mapping;
}

function slimRow(row: Record<string, string>, mapping: Record<string, ImportRole>) {
  const out: Record<string, string> = {};
  for (const [header, role] of Object.entries(mapping)) {
    if (role === "skip") continue;
    const max = role === "review" ? 900 : 220;
    out[header] = (row[header] ?? "").slice(0, max);
  }
  return out;
}

function parseFile(file: File): Promise<ParsedData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (json.length === 0) throw new Error("Filen är tom.");
        const headerSet = new Set<string>();
        json.forEach((row) => Object.keys(row).forEach((key) => headerSet.add(key)));
        const headers = Array.from(headerSet);
        const rows = json.map((row) => {
          const mapped: Record<string, string> = {};
          headers.forEach((h) => { mapped[h] = String(row[h] ?? ""); });
          return mapped;
        });
        resolve({ headers, rows, fileName: file.name, fileSize: file.size });
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Kunde inte läsa filen."));
      }
    };
    reader.onerror = () => reject(new Error("Kunde inte läsa filen."));
    reader.readAsArrayBuffer(file);
  });
}

function normalizeEmail(v?: string | null): string | null {
  if (!v) return null;
  const m = v.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function normalizeUrl(v?: string | null): string | null {
  if (!v) return null;
  const first = v.trim().split(/[\s,]+/).find((x) => /[\w-]+\.[a-z]{2,}/i.test(x)) ?? v.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(first) ? first : `https://${first}`);
    u.hash = ""; u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}

function extractDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch { return null; }
}

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]+/gu, "").trim();
}
