import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Play, Pause, Trash2, Pencil, Zap, AlertCircle, UserPlus, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    active: "bg-accent/15 text-accent",
    paused: "bg-yellow-500/15 text-yellow-600",
  };
  return map[s] ?? "bg-muted text-muted-foreground";
};

const Sequences = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [listId, setListId] = useState<string>("");

  const { data: sequences = [], isLoading } = useQuery({
    queryKey: ["sequences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequences")
        .select("id, name, status, contact_list_id, sender_rotation, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: lists = [] } = useQuery({
    queryKey: ["contact_lists"],
    queryFn: async () => {
      const { data } = await supabase.from("contact_lists").select("id, name");
      return data ?? [];
    },
  });

  const { data: stepCounts = {} } = useQuery({
    queryKey: ["sequence-step-counts", sequences.map((s) => s.id)],
    enabled: sequences.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("sequence_steps")
        .select("sequence_id");
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r) => {
        counts[r.sequence_id] = (counts[r.sequence_id] ?? 0) + 1;
      });
      return counts;
    },
  });

  const { data: enrollStats = {} } = useQuery({
    queryKey: ["sequence-enroll-stats", sequences.map((s) => s.id)],
    enabled: sequences.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("enrollments")
        .select("sequence_id, status, last_error");
      const stats: Record<string, { total: number; active: number; waiting: number; completed: number; failed: number; unsubscribed: number; lastError?: string | null; waitingReason?: string | null }> = {};
      (data ?? []).forEach((r: any) => {
        const s = stats[r.sequence_id] ??= { total: 0, active: 0, waiting: 0, completed: 0, failed: 0, unsubscribed: 0 };
        s.total++;
        // Internal throttle bookkeeping uses last_error as a marker; never expose it.
        const visibleError = typeof r.last_error === "string" && r.last_error.startsWith("__pending_throttle:") ? null : r.last_error;
        if (r.status === "active") s.active++;
        else if (r.status === "waiting_capacity") { s.waiting++; if (visibleError && !s.waitingReason) s.waitingReason = visibleError; }
        else if (r.status === "completed") s.completed++;
        else if (r.status === "failed") { s.failed++; if (visibleError && !s.lastError) s.lastError = visibleError; }
        else if (r.status === "unsubscribed") s.unsubscribed++;
      });
      return stats;
    },
  });

  const { data: domains = [] } = useQuery({
    queryKey: ["sending_domains"],
    queryFn: async () => {
      const { data } = await supabase.from("sending_domains").select("domain, is_verified, is_active");
      return data ?? [];
    },
  });
  const unverified = (domains as any[]).filter((d) => d.is_active && !d.is_verified);
  const verified = (domains as any[]).filter((d) => d.is_active && d.is_verified);

  // Most recent enroll_skipped event per sequence so we can show a yellow banner
  // explaining why a sequence has 0 active enrollments.
  const { data: skipEvents = {} } = useQuery({
    queryKey: ["sequence-skip-events", sequences.map((s) => s.id)],
    enabled: sequences.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("contact_activity")
        .select("sequence_id, metadata, created_at")
        .eq("activity_type", "enroll_skipped")
        .order("created_at", { ascending: false })
        .limit(200);
      const out: Record<string, { metadata: any; created_at: string }> = {};
      (data ?? []).forEach((r: any) => {
        if (!r.sequence_id) return;
        if (!out[r.sequence_id]) out[r.sequence_id] = { metadata: r.metadata, created_at: r.created_at };
      });
      return out;
    },
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-sequences", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast({ title: "Worker ran", description: `processed=${data?.processed ?? 0} sent=${data?.sent ?? 0} advanced=${data?.advanced ?? 0} failed=${data?.failed ?? 0}` });
      qc.invalidateQueries({ queryKey: ["sequence-enroll-stats"] });
    },
    onError: (e: Error) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
  });

  const enrollNow = useMutation({
    mutationFn: async ({ id, allowRecontact }: { id: string; allowRecontact: boolean }) => {
      const { data, error } = await supabase.functions.invoke("enroll-contacts", {
        body: { sequence_id: id, allow_recontact: allowRecontact },
      });
      if (error) throw error;
      return data as { enrolled: number; already_contacted: number; suppressed: number; already_enrolled: number; total_contacts: number };
    },
    onSuccess: (data) => {
      const parts: string[] = [`${data.enrolled} enrolled`];
      if (data.already_contacted) parts.push(`${data.already_contacted} skipped (previously contacted)`);
      if (data.already_enrolled) parts.push(`${data.already_enrolled} already in this sequence`);
      if (data.suppressed) parts.push(`${data.suppressed} suppressed`);
      toast({ title: "Enrollment complete", description: parts.join(" · ") });
      qc.invalidateQueries({ queryKey: ["sequence-enroll-stats"] });
      qc.invalidateQueries({ queryKey: ["sequence-skip-events"] });
    },
    onError: (e: Error) => toast({ title: "Enrollment failed", description: e.message, variant: "destructive" }),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("sequences")
        .insert({
          user_id: user!.id,
          name: name.trim() || "Untitled sequence",
          contact_list_id: listId || null,
          status: "draft",
          sender_rotation: [],
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      setOpen(false);
      setName("");
      setListId("");
      navigate(`/sequences/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const next = status === "active" ? "paused" : "active";
      const { error } = await supabase.from("sequences").update({ status: next }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sequences"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("sequence_steps").delete().eq("sequence_id", id);
      await supabase.from("enrollments").delete().eq("sequence_id", id);
      const { error } = await supabase.from("sequences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sequences"] });
      toast({ title: "Sequence deleted" });
    },
  });

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sequences</h1>
            <p className="text-muted-foreground text-sm mt-1">Build multi-step outreach campaigns.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
              <Zap className="h-4 w-4 mr-1.5" /> {runNow.isPending ? "Running…" : "Run now"}
            </Button>
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> New Sequence</Button>
          </div>
        </div>

        {unverified.length > 0 && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive">
                {unverified.length} sending domain{unverified.length === 1 ? "" : "s"} not verified — emails from {unverified.map((d: any) => d.domain).join(", ")} will fail.
              </p>
              <p className="text-muted-foreground mt-1">
                Only {verified.map((d: any) => d.domain).join(", ") || "(none)"} can currently send. Verify the others under Cloud → Emails → Manage Domains.
              </p>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : sequences.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-muted-foreground text-sm mb-4">No sequences yet. Create one to start.</p>
              <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> New Sequence</Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Steps</TableHead>
                  <TableHead>List</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sequences.map((s) => {
                  const list = lists.find((l) => l.id === s.contact_list_id);
                  const st = (enrollStats as any)[s.id];
                  const skip = (skipEvents as any)[s.id];
                  const showSkipBanner =
                    s.status === "active" &&
                    (!st || st.active === 0) &&
                    skip &&
                    (skip.metadata?.already_contacted ?? 0) > 0;
                  return (
                    <>
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge(s.status)}`}>
                          {s.status}
                        </span>
                      </TableCell>
                      <TableCell>{stepCounts[s.id] ?? 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{list?.name ?? "—"}</TableCell>
                      <TableCell>
                        {(() => {
                          if (!st || st.total === 0) return <span className="text-muted-foreground text-sm">0</span>;
                          return (
                            <div className="flex items-center gap-2 text-xs flex-wrap">
                              <span title="active" className="text-accent font-medium">{st.active} active</span>
                              {st.waiting > 0 && (
                                <span title={st.waitingReason ?? "waiting for sender capacity — resumes tomorrow"} className="text-yellow-600 font-medium">
                                  {st.waiting} paused
                                </span>
                              )}
                              {st.completed > 0 && <span title="completed" className="text-muted-foreground">{st.completed} done</span>}
                              {st.failed > 0 && (
                                <span title={st.lastError ?? "failed"} className="text-destructive flex items-center gap-0.5 font-medium">
                                  <AlertCircle className="h-3 w-3" />{st.failed}
                                </span>
                              )}
                              {st.unsubscribed > 0 && <span title="unsubscribed" className="text-yellow-600">{st.unsubscribed} unsub</span>}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Re-run enrollment for this sequence"
                          onClick={() => {
                            const allow = confirm(
                              `Enroll contacts now for "${s.name}"?\n\nClick OK to also include people who were already contacted from other sequences (re-contact).\nClick Cancel to skip them.`
                            );
                            // OK = allow re-contact; Cancel from confirm() returns false → still enroll, just skip recontacts
                            enrollNow.mutate({ id: s.id, allowRecontact: allow });
                          }}
                          disabled={enrollNow.isPending}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/sequences/${s.id}`)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {s.status !== "draft" && (
                          <Button size="sm" variant="ghost" onClick={() => toggleStatus.mutate({ id: s.id, status: s.status })}>
                            {s.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => {
                          if (confirm(`Delete "${s.name}"?`)) remove.mutate(s.id);
                        }}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {showSkipBanner && (
                      <TableRow key={s.id + "-skip"} className="bg-yellow-500/5 hover:bg-yellow-500/5">
                        <TableCell colSpan={7} className="py-2">
                          <div className="flex items-start gap-2 text-xs text-yellow-700 dark:text-yellow-500">
                            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>
                              0 active enrollments — last enrollment skipped{" "}
                              <strong>{skip.metadata.already_contacted}</strong> contact
                              {skip.metadata.already_contacted === 1 ? "" : "s"} because they were already
                              contacted from another sequence. Use the <UserPlus className="inline h-3 w-3 mx-0.5" />
                              button to re-enroll (you can choose to allow re-contact).
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Sequence</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q1 Outreach" />
            </div>
            <div>
              <Label>Contact list</Label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger><SelectValue placeholder="Pick a list (optional)" /></SelectTrigger>
                <SelectContent>
                  {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create & edit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Sequences;
