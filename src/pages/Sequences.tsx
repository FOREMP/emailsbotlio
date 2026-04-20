import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Play, Pause, Trash2, Pencil, Zap, AlertCircle } from "lucide-react";
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

  const { data: enrollCounts = {} } = useQuery({
    queryKey: ["sequence-enroll-counts", sequences.map((s) => s.id)],
    enabled: sequences.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("enrollments").select("sequence_id");
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r) => {
        counts[r.sequence_id] = (counts[r.sequence_id] ?? 0) + 1;
      });
      return counts;
    },
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
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> New Sequence</Button>
        </div>

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
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sequences.map((s) => {
                  const list = lists.find((l) => l.id === s.contact_list_id);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge(s.status)}`}>
                          {s.status}
                        </span>
                      </TableCell>
                      <TableCell>{stepCounts[s.id] ?? 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{list?.name ?? "—"}</TableCell>
                      <TableCell>{enrollCounts[s.id] ?? 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
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
