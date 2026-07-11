import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Sparkles, Search, ExternalLink, RefreshCw, Plus, Wand2, Rocket } from "lucide-react";
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
  contacts?: { first_name: string | null; last_name: string | null; email: string | null };
};

const statusColor: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  auditing: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  audited: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  scraping: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  scraped: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
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
  });

  const { data: lists = [] } = useQuery({
    queryKey: ["contact_lists_for_sites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contact_lists").select("id,name").order("name");
      if (error) throw error;
      return data ?? [];
    },
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

  const runStep = async (siteId: string, step: "audit-site" | "scrape-lead-data") => {
    setBusyId(siteId);
    try {
      const { data, error } = await supabase.functions.invoke(step, {
        body: { generated_site_id: siteId },
      });
      if (error) throw error;
      toast.success(`${step} done`);
      qc.invalidateQueries({ queryKey: ["generated_sites"] });
      return data;
    } catch (e) {
      toast.error(`${step} failed: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Sites;
