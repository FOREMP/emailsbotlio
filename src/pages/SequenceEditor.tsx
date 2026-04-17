import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Send, ArrowLeft, Plus, Trash2, Sparkles, FileText, Save, Users, ChevronUp, ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";

type Step = {
  id: string;
  step_order: number;
  delay_days: number;
  use_ai: boolean;
  ai_model: string;
  ai_prompt: string | null;
  subject_template: string | null;
  body_template: string | null;
};

const SequenceEditor = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [contactListId, setContactListId] = useState<string>("");
  const [status, setStatus] = useState<string>("draft");
  const [senderRotation, setSenderRotation] = useState<string[]>([]);
  const [enrollResult, setEnrollResult] = useState<string | null>(null);

  const seqQuery = useQuery({
    queryKey: ["sequence", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequences")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (seqQuery.data) {
      setName(seqQuery.data.name);
      setContactListId(seqQuery.data.contact_list_id ?? "");
      setStatus(seqQuery.data.status);
      setSenderRotation(Array.isArray(seqQuery.data.sender_rotation) ? seqQuery.data.sender_rotation as string[] : []);
    }
  }, [seqQuery.data]);

  const { data: lists = [] } = useQuery({
    queryKey: ["contact_lists"],
    queryFn: async () => (await supabase.from("contact_lists").select("id, name, columns")).data ?? [],
  });

  const { data: senders = [] } = useQuery({
    queryKey: ["senders-active"],
    queryFn: async () => (await supabase.from("senders").select("id, from_name, from_email, is_active").eq("is_active", true)).data ?? [],
  });

  const { data: steps = [], refetch: refetchSteps } = useQuery({
    queryKey: ["sequence-steps", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sequence_steps")
        .select("*")
        .eq("sequence_id", id!)
        .order("step_order");
      if (error) throw error;
      return data as Step[];
    },
  });

  const { data: enrollStats } = useQuery({
    queryKey: ["enroll-stats", id, contactListId],
    enabled: !!contactListId,
    queryFn: async () => {
      const [contacts, enrolled, dnc] = await Promise.all([
        supabase.from("contacts").select("*", { count: "exact", head: true }).eq("list_id", contactListId),
        supabase.from("enrollments").select("*", { count: "exact", head: true }).eq("sequence_id", id!),
        supabase.from("do_not_contact").select("*", { count: "exact", head: true }),
      ]);
      return {
        contacts: contacts.count ?? 0,
        enrolled: enrolled.count ?? 0,
        suppressed: dnc.count ?? 0,
      };
    },
  });

  const list = lists.find((l) => l.id === contactListId);
  const variables: string[] = ["first_name", "last_name", "email"];
  const customCols = (list?.columns as string[] | undefined) ?? [];
  const allVars = [...new Set([...variables, ...customCols])];

  const saveSettings = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("sequences")
        .update({
          name,
          contact_list_id: contactListId || null,
          status,
          sender_rotation: senderRotation,
        })
        .eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["sequence", id] });
      qc.invalidateQueries({ queryKey: ["sequences"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const addStep = useMutation({
    mutationFn: async () => {
      const nextOrder = steps.length;
      const { error } = await supabase.from("sequence_steps").insert({
        user_id: user!.id,
        sequence_id: id!,
        step_order: nextOrder,
        delay_days: nextOrder === 0 ? 0 : 3,
        use_ai: true,
        ai_model: "google/gemini-2.5-flash",
        ai_prompt: "Write a friendly outreach email to {{first_name}} introducing our product.",
        subject_template: "Quick intro",
      });
      if (error) throw error;
    },
    onSuccess: () => refetchSteps(),
  });

  const updateStep = async (stepId: string, patch: Partial<Step>) => {
    const { error } = await supabase.from("sequence_steps").update(patch).eq("id", stepId);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else refetchSteps();
  };

  const deleteStep = async (stepId: string) => {
    if (!confirm("Delete this step?")) return;
    await supabase.from("sequence_steps").delete().eq("id", stepId);
    refetchSteps();
  };

  const moveStep = async (stepId: string, dir: -1 | 1) => {
    const idx = steps.findIndex((s) => s.id === stepId);
    const swap = steps[idx + dir];
    if (!swap) return;
    await Promise.all([
      supabase.from("sequence_steps").update({ step_order: swap.step_order }).eq("id", stepId),
      supabase.from("sequence_steps").update({ step_order: steps[idx].step_order }).eq("id", swap.id),
    ]);
    refetchSteps();
  };

  const enroll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("enroll-contacts", {
        body: { sequence_id: id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setEnrollResult(`Enrolled ${data.inserted} · Skipped ${data.already_enrolled} already enrolled, ${data.suppressed} suppressed, ${data.no_email} without email.`);
      qc.invalidateQueries({ queryKey: ["enroll-stats", id, contactListId] });
      toast({ title: "Enrollment complete", description: `${data.inserted} contacts enrolled` });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (seqQuery.isLoading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!seqQuery.data) return <div className="p-8 text-center">Not found</div>;

  const canEnroll = status === "active" && steps.length > 0 && senderRotation.length > 0 && !!contactListId;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/sequences")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Sequences
          </Button>
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            <span className="font-semibold truncate max-w-[300px]">{name || "Sequence"}</span>
          </div>
          <Button size="sm" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6 max-w-4xl">
        {/* Settings */}
        <div className="rounded-xl border border-border bg-card shadow-card p-6">
          <h2 className="font-semibold mb-4">Settings</h2>
          <div className="grid gap-4">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Contact list</Label>
                <Select value={contactListId} onValueChange={setContactListId}>
                  <SelectTrigger><SelectValue placeholder="Pick a list" /></SelectTrigger>
                  <SelectContent>
                    {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Sender rotation</Label>
              <p className="text-xs text-muted-foreground mb-2">Selected senders rotate per send.</p>
              {senders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active senders. <Link to="/senders" className="text-primary hover:underline">Add one</Link>.</p>
              ) : (
                <div className="space-y-2">
                  {senders.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={senderRotation.includes(s.id)}
                        onCheckedChange={(v) => {
                          setSenderRotation((prev) => v ? [...prev, s.id] : prev.filter((x) => x !== s.id));
                        }}
                      />
                      <span>{s.from_name} <span className="text-muted-foreground">&lt;{s.from_email}&gt;</span></span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="rounded-xl border border-border bg-card shadow-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Steps ({steps.length})</h2>
            <Button size="sm" variant="outline" onClick={() => addStep.mutate()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add step
            </Button>
          </div>

          {allVars.length > 0 && (
            <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border">
              <p className="text-xs text-muted-foreground mb-2">Available variables (click to copy):</p>
              <div className="flex flex-wrap gap-1.5">
                {allVars.map((v) => (
                  <button
                    key={v}
                    onClick={() => {
                      navigator.clipboard.writeText(`{{${v}}}`);
                      toast({ title: `Copied {{${v}}}` });
                    }}
                    className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-mono hover:bg-primary/20"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No steps yet. Add the first one above.</p>
          ) : (
            <div className="space-y-4">
              {steps.map((step, idx) => (
                <div key={step.id} className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium">
                        Step {idx + 1} · Day {step.delay_days}
                      </span>
                      {step.use_ai ? <Sparkles className="h-3.5 w-3.5 text-accent" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => moveStep(step.id, -1)}>
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" disabled={idx === steps.length - 1} onClick={() => moveStep(step.id, 1)}>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteStep(step.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Delay (days)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={step.delay_days}
                        onChange={(e) => updateStep(step.id, { delay_days: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex items-center gap-2 h-10">
                        <Switch checked={step.use_ai} onCheckedChange={(v) => updateStep(step.id, { use_ai: v })} />
                        <Label className="text-sm cursor-pointer">Use AI to generate</Label>
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Subject {step.use_ai && "(hint, optional)"}</Label>
                    <Input
                      value={step.subject_template ?? ""}
                      onChange={(e) => updateStep(step.id, { subject_template: e.target.value })}
                      placeholder="Quick question, {{first_name}}"
                    />
                  </div>

                  {step.use_ai ? (
                    <>
                      <div>
                        <Label className="text-xs">AI prompt</Label>
                        <Textarea
                          rows={4}
                          value={step.ai_prompt ?? ""}
                          onChange={(e) => updateStep(step.id, { ai_prompt: e.target.value })}
                          placeholder="Write a friendly cold email to {{first_name}} at {{company}}…"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Model</Label>
                        <Select value={step.ai_model} onValueChange={(v) => updateStep(step.id, { ai_model: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="google/gemini-2.5-flash">Gemini 2.5 Flash (free)</SelectItem>
                            <SelectItem value="google/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (free)</SelectItem>
                            <SelectItem value="google/gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : (
                    <div>
                      <Label className="text-xs">Body template</Label>
                      <Textarea
                        rows={6}
                        value={step.body_template ?? ""}
                        onChange={(e) => updateStep(step.id, { body_template: e.target.value })}
                        placeholder="Hi {{first_name}}, …"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Enrollment */}
        <div className="rounded-xl border border-border bg-card shadow-card p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Users className="h-4 w-4" /> Enrollment</h2>
          {!contactListId ? (
            <p className="text-sm text-muted-foreground">Pick a contact list above to enable enrollment.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">In list</div>
                  <div className="text-xl font-bold">{enrollStats?.contacts ?? 0}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Already enrolled</div>
                  <div className="text-xl font-bold">{enrollStats?.enrolled ?? 0}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Suppressed (DNC)</div>
                  <div className="text-xl font-bold">{enrollStats?.suppressed ?? 0}</div>
                </div>
              </div>
              <Button
                onClick={() => enroll.mutate()}
                disabled={!canEnroll || enroll.isPending}
              >
                {enroll.isPending ? "Enrolling…" : "Enroll all eligible"}
              </Button>
              {!canEnroll && (
                <p className="text-xs text-muted-foreground mt-2">
                  Requires status=Active, ≥1 step, ≥1 sender, and a contact list. Save settings after changes.
                </p>
              )}
              {enrollResult && <p className="text-sm text-accent mt-3">{enrollResult}</p>}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default SequenceEditor;
