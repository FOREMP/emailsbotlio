import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Trash2, Sparkles, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export interface FlowNode {
  id: string;
  node_type: string;
  config: Record<string, any>;
}

interface Props {
  node: FlowNode | null;
  onChange: (config: Record<string, any>) => void;
  onClose: () => void;
  onDelete: () => void;
  contactListId: string | null;
}

export const NodeInspector = ({ node, onChange, onClose, onDelete, contactListId }: Props) => {
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);

  const { data: lists = [] } = useQuery({
    queryKey: ["inspector-lists"],
    queryFn: async () => {
      const { data } = await supabase.from("contact_lists").select("id, name");
      return data ?? [];
    },
    enabled: node?.node_type === "trigger",
  });

  const { data: senders = [] } = useQuery({
    queryKey: ["inspector-senders"],
    queryFn: async () => {
      const { data } = await supabase.from("senders").select("id, from_name, from_email").eq("is_active", true).order("from_email");
      return data ?? [];
    },
    enabled: node?.node_type === "send_email",
  });

  const { data: domains = [] } = useQuery({
    queryKey: ["inspector-domains"],
    queryFn: async () => {
      const { data } = await supabase.from("sending_domains").select("brand").eq("is_active", true);
      return Array.from(new Set(((data as any[]) ?? []).map((d) => d.brand)));
    },
    enabled: node?.node_type === "send_email",
  });

  const { data: variables = [] } = useQuery({
    queryKey: ["inspector-vars", contactListId],
    enabled: node?.node_type === "send_email" && !!contactListId,
    queryFn: async () => {
      const { data } = await supabase
        .from("contact_lists")
        .select("columns")
        .eq("id", contactListId!)
        .maybeSingle();
      const cols = (data?.columns as any[]) ?? [];
      return ["first_name", "last_name", "email", ...cols.map((c) => (typeof c === "string" ? c : c?.name)).filter(Boolean)];
    },
  });

  if (!node) return null;
  const cfg = node.config ?? {};
  const set = (k: string, v: any) => onChange({ ...cfg, [k]: v });

  const handlePreview = async () => {
    if (!cfg.prompt) {
      toast({ title: "Add a prompt first", variant: "destructive" });
      return;
    }
    setPreviewing(true);
    try {
      const { data: contact } = await supabase
        .from("contacts")
        .select("first_name, last_name, email, custom_fields")
        .eq("list_id", contactListId!)
        .limit(1)
        .maybeSingle();
      const { data, error } = await supabase.functions.invoke("generate-email", {
        body: { contact: contact ?? { first_name: "Sample" }, prompt: cfg.prompt, subject_hint: cfg.subject_hint },
      });
      if (error) throw error;
      setPreview(data as any);
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <aside className="w-96 border-l border-border bg-card overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">{node.node_type.replace("_", " ")}</div>
          <div className="font-semibold text-sm mt-0.5">Configure node</div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      <div className="p-4 space-y-4 flex-1">
        {node.node_type === "trigger" && (
          <div>
            <Label>Contact list</Label>
            <Select
              value={cfg.contact_list_id ?? ""}
              onValueChange={(v) => {
                const list = lists.find((l) => l.id === v);
                onChange({ ...cfg, contact_list_id: v, contact_list_name: list?.name });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Pick a list" /></SelectTrigger>
              <SelectContent>
                {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {node.node_type === "send_email" && (
          <>
            <div>
              <Label>Sender strategy</Label>
              <Select
                value={cfg.sender_strategy ?? "all"}
                onValueChange={(v) => onChange({ ...cfg, sender_strategy: v, sender_id: v === "specific" ? cfg.sender_id : undefined, brand: v === "brand" ? (cfg.brand ?? domains[0]) : undefined })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Rotate across all active senders</SelectItem>
                  {domains.map((b) => (
                    <SelectItem key={b} value="brand" disabled={cfg.sender_strategy === "brand" && cfg.brand === b}>
                      Rotate within brand: {b}
                    </SelectItem>
                  ))}
                  <SelectItem value="specific">Specific sender</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {cfg.sender_strategy === "brand" && (
              <div>
                <Label>Brand</Label>
                <Select value={cfg.brand ?? domains[0]} onValueChange={(v) => set("brand", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {domains.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {cfg.sender_strategy === "specific" && (
              <div>
                <Label>Sender</Label>
                <Select value={cfg.sender_id ?? ""} onValueChange={(v) => set("sender_id", v)}>
                  <SelectTrigger><SelectValue placeholder="Pick sender" /></SelectTrigger>
                  <SelectContent>
                    {senders.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.from_name} &lt;{s.from_email}&gt;</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Email content</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <Button
                  type="button"
                  size="sm"
                  variant={(cfg.mode ?? "ai") === "ai" ? "default" : "outline"}
                  onClick={() => set("mode", "ai")}
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Use AI
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={cfg.mode === "template" ? "default" : "outline"}
                  onClick={() => set("mode", "template")}
                >
                  No AI (template)
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {(cfg.mode ?? "ai") === "ai"
                  ? "Both subject and body are generated by gpt-4.1-mini per contact."
                  : "Write your own subject and body, use {{variables}} for personalization."}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <Label className="text-xs">Anti-spam send delay</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Base (sec)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={cfg.send_delay_seconds ?? 60}
                    onChange={(e) => set("send_delay_seconds", Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Jitter ± (sec)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={cfg.send_jitter_seconds ?? 30}
                    onChange={(e) => set("send_jitter_seconds", Number(e.target.value))}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Each send waits {cfg.send_delay_seconds ?? 60}s ± {cfg.send_jitter_seconds ?? 30}s of randomness to avoid spam filters.
              </p>
            </div>

            {(cfg.mode ?? "ai") === "ai" ? (
              <>
                <div>
                  <Label>AI subject prompt</Label>
                  <Input
                    value={cfg.subject_hint ?? ""}
                    onChange={(e) => set("subject_hint", e.target.value)}
                    placeholder='e.g. "Quick question about {{company}}"'
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    AI will craft a unique subject per contact, guided by this hint. Use {`{{variables}}`} to personalize.
                  </p>
                </div>
                <div>
                  <Label>AI body prompt</Label>
                  <Textarea
                    rows={6}
                    value={cfg.prompt ?? ""}
                    onChange={(e) => set("prompt", e.target.value)}
                    placeholder="Write a 3-sentence cold email to {{first_name}} at {{company}}, mention their recent {{trigger_event}}, and ask for a 15-min call."
                  />
                </div>
                <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewing} className="w-full">
                  {previewing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                  Preview with sample contact
                </Button>
                {preview && (
                  <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-2">
                    <div><span className="font-semibold">Subject:</span> {preview.subject}</div>
                    <div className="whitespace-pre-wrap">{preview.body}</div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <Label>Subject</Label>
                  <Input value={cfg.subject ?? ""} onChange={(e) => set("subject", e.target.value)} />
                </div>
                <div>
                  <Label>Body</Label>
                  <Textarea rows={8} value={cfg.body ?? ""} onChange={(e) => set("body", e.target.value)} />
                </div>
              </>
            )}

            {variables.length > 0 && (
              <div>
                <Label className="text-xs">Available variables</Label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {variables.map((v) => (
                    <span key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">
                      {`{{${v}}}`}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {node.node_type === "wait" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Duration</Label>
              <Input type="number" min={0} value={cfg.duration ?? 1} onChange={(e) => set("duration", Number(e.target.value))} />
            </div>
            <div>
              <Label>Unit</Label>
              <Select value={cfg.unit ?? "days"} onValueChange={(v) => set("unit", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">minutes</SelectItem>
                  <SelectItem value="hours">hours</SelectItem>
                  <SelectItem value="days">days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {node.node_type === "log_activity" && (
          <>
            <div>
              <Label>Activity type</Label>
              <Input value={cfg.activity_type ?? ""} onChange={(e) => set("activity_type", e.target.value)} placeholder="contacted / opened / custom" />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea rows={3} value={cfg.note ?? ""} onChange={(e) => set("note", e.target.value)} />
            </div>
          </>
        )}

        {node.node_type === "condition" && (
          <>
            <div>
              <Label>Check</Label>
              <Select value={cfg.condition_type ?? "opened"} onValueChange={(v) => set("condition_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="opened">Email opened</SelectItem>
                  <SelectItem value="replied">Email replied</SelectItem>
                  <SelectItem value="clicked">Link clicked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Wait window (hours)</Label>
              <Input type="number" min={1} value={cfg.wait_window_hours ?? 24} onChange={(e) => set("wait_window_hours", Number(e.target.value))} />
            </div>
            <p className="text-xs text-muted-foreground">YES branch fires if event happens within window. NO branch fires after timeout.</p>
          </>
        )}

        {node.node_type === "throttle" && (
          <div>
            <Label>Max emails per day (this branch)</Label>
            <Input
              type="number"
              min={1}
              value={cfg.max_per_day ?? 50}
              onChange={(e) => set("max_per_day", Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              When this branch has already sent this many emails today, remaining contacts wait until tomorrow.
            </p>
          </div>
        )}

        {node.node_type === "schedule" && (
          <>
            <div>
              <Label>Time of day (UTC, HH:MM)</Label>
              <Input
                type="time"
                value={cfg.time_of_day ?? "09:00"}
                onChange={(e) => set("time_of_day", e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Contacts that reach this node wait until this time (UTC) each day before continuing.
              </p>
            </div>
            <div>
              <Label>Days of week (optional)</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => {
                  const active = (cfg.days ?? []).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        const cur: string[] = cfg.days ?? [];
                        set("days", active ? cur.filter((x) => x !== d) : [...cur, d]);
                      }}
                      className={`text-xs px-2 py-1 rounded border ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Leave empty to run every day. Selected days only otherwise.
              </p>
            </div>
          </>
        )}

        {node.node_type === "end" && (
          <p className="text-sm text-muted-foreground">Terminates this branch. No configuration needed.</p>
        )}
      </div>

      {node.node_type !== "trigger" && (
        <div className="p-4 border-t border-border">
          <Button variant="destructive" size="sm" className="w-full" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete node
          </Button>
        </div>
      )}
    </aside>
  );
};
