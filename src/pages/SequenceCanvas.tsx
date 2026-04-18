import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, LogOut, Send, Loader2, CheckCircle2, Users } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NodePalette } from "@/components/sequence-canvas/NodePalette";
import { NodeInspector, type FlowNode } from "@/components/sequence-canvas/NodeInspector";
import { TriggerNode } from "@/components/sequence-canvas/nodes/TriggerNode";
import { SendEmailNode } from "@/components/sequence-canvas/nodes/SendEmailNode";
import { WaitNode } from "@/components/sequence-canvas/nodes/WaitNode";
import { LogActivityNode } from "@/components/sequence-canvas/nodes/LogActivityNode";
import { ConditionNode } from "@/components/sequence-canvas/nodes/ConditionNode";
import { EndNode } from "@/components/sequence-canvas/nodes/EndNode";

const nodeTypes = {
  trigger: TriggerNode,
  send_email: SendEmailNode,
  wait: WaitNode,
  log_activity: LogActivityNode,
  condition: ConditionNode,
  end: EndNode,
};

const defaultConfig = (type: string): Record<string, any> => {
  switch (type) {
    case "send_email": return { mode: "ai", sender_id: "rotate", prompt: "", send_delay_seconds: 60, send_jitter_seconds: 30 };
    case "wait": return { duration: 1, unit: "days" };
    case "log_activity": return { activity_type: "contacted", note: "" };
    case "condition": return { condition_type: "opened", wait_window_hours: 24 };
    default: return {};
  }
};

const Inner = () => {
  const { id } = useParams();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("draft");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<number | null>(null);
  const initialLoad = useRef(true);

  const { data: sequence } = useQuery({
    queryKey: ["sequence", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("sequences").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: dbNodes = [] } = useQuery({
    queryKey: ["seq-nodes", id],
    queryFn: async () => {
      const { data } = await supabase.from("sequence_nodes").select("*").eq("sequence_id", id!);
      return data ?? [];
    },
  });

  const { data: dbEdges = [] } = useQuery({
    queryKey: ["seq-edges", id],
    queryFn: async () => {
      const { data } = await supabase.from("sequence_edges").select("*").eq("sequence_id", id!);
      return data ?? [];
    },
  });

  // Load from DB into RF state once
  useEffect(() => {
    if (!sequence) return;
    setName(sequence.name);
    setStatus(sequence.status);
  }, [sequence]);

  const seeding = useRef(false);
  useEffect(() => {
    if (!initialLoad.current) return;
    if (dbNodes.length === 0 && sequence && id && user && !seeding.current) {
      // Auto-seed a default cold-outreach + 1 follow-up template (run ONCE)
      seeding.current = true;
      initialLoad.current = false;
      (async () => {
        const triggerCfg = sequence.contact_list_id ? { contact_list_id: sequence.contact_list_id } : {};
        const seedNodes = [
          { node_type: "trigger",     position_x: 250, position_y: 40,  config: triggerCfg },
          { node_type: "send_email",  position_x: 250, position_y: 180, config: { mode: "ai", sender_strategy: "all", prompt: "Write a 3-sentence cold email to {{first_name}} introducing our service. Personal, specific, no fluff. Ask for a 15-min call.", subject_hint: "Quick question about {{company}}", send_delay_seconds: 60, send_jitter_seconds: 30 } },
          { node_type: "wait",        position_x: 250, position_y: 340, config: { duration: 3, unit: "days" } },
          { node_type: "send_email",  position_x: 250, position_y: 480, config: { mode: "ai", sender_strategy: "all", prompt: "Write a short, friendly follow-up email to {{first_name}}. Reference the previous email gently, restate the value in one sentence, and ask if next week works for a quick chat.", subject_hint: "Following up", send_delay_seconds: 60, send_jitter_seconds: 30 } },
          { node_type: "end",         position_x: 250, position_y: 640, config: {} },
        ].map((n) => ({ ...n, sequence_id: id, user_id: user.id }));

        const { data: insertedNodes, error: nodeErr } = await supabase
          .from("sequence_nodes")
          .insert(seedNodes)
          .select();
        if (nodeErr || !insertedNodes) { seeding.current = false; return; }

        // Wire edges in order
        const edgePayload = [];
        for (let i = 0; i < insertedNodes.length - 1; i++) {
          edgePayload.push({
            sequence_id: id,
            user_id: user.id,
            source_node_id: insertedNodes[i].id,
            target_node_id: insertedNodes[i + 1].id,
            source_handle: "default",
          });
        }
        if (edgePayload.length > 0) {
          await supabase.from("sequence_edges").insert(edgePayload);
        }
        qc.invalidateQueries({ queryKey: ["seq-nodes", id] });
        qc.invalidateQueries({ queryKey: ["seq-edges", id] });
      })();
      return;
    }
    if (dbNodes.length > 0) {
      setNodes(
        dbNodes.map((n: any) => ({
          id: n.id,
          type: n.node_type,
          position: { x: n.position_x, y: n.position_y },
          data: { config: n.config, node_type: n.node_type },
        })),
      );
      setEdges(
        dbEdges.map((e: any) => ({
          id: e.id,
          source: e.source_node_id,
          target: e.target_node_id,
          sourceHandle: e.source_handle === "default" ? null : e.source_handle,
          animated: sequence?.status === "active",
        })),
      );
      initialLoad.current = false;
    }
  }, [dbNodes, dbEdges, sequence, id, user, qc]);

  const triggerSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = window.setTimeout(async () => {
      try {
        // Upsert nodes
        const nodePayload = nodes.map((n) => ({
          id: n.id,
          sequence_id: id!,
          user_id: user!.id,
          node_type: (n.data as any).node_type ?? n.type!,
          position_x: n.position.x,
          position_y: n.position.y,
          config: (n.data as any).config ?? {},
        }));
        if (nodePayload.length > 0) {
          await supabase.from("sequence_nodes").upsert(nodePayload, { onConflict: "id" });
        }
        // Replace edges
        await supabase.from("sequence_edges").delete().eq("sequence_id", id!);
        const edgePayload = edges.map((e) => ({
          sequence_id: id!,
          user_id: user!.id,
          source_node_id: e.source,
          target_node_id: e.target,
          source_handle: e.sourceHandle ?? "default",
        }));
        if (edgePayload.length > 0) {
          await supabase.from("sequence_edges").insert(edgePayload);
        }
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1200);
      } catch (e: any) {
        setSaveState("idle");
        toast({ title: "Save failed", description: e.message, variant: "destructive" });
      }
    }, 1000);
  }, [nodes, edges, id, user]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
    if (changes.some((c) => c.type === "position" || c.type === "remove")) triggerSave();
  }, [triggerSave]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
    if (changes.some((c) => c.type === "remove")) triggerSave();
  }, [triggerSave]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => addEdge({ ...conn, animated: status === "active" }, eds));
    triggerSave();
  }, [triggerSave, status]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/reactflow");
    if (!type) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const config = defaultConfig(type);
    const { data, error } = await supabase
      .from("sequence_nodes")
      .insert({
        sequence_id: id!,
        user_id: user!.id,
        node_type: type,
        position_x: position.x,
        position_y: position.y,
        config,
      })
      .select()
      .single();
    if (error) {
      toast({ title: "Could not add node", description: error.message, variant: "destructive" });
      return;
    }
    setNodes((nds) => [
      ...nds,
      {
        id: data.id,
        type,
        position,
        data: { config, node_type: type },
      },
    ]);
  }, [screenToFlowPosition, id, user]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const updateNodeConfig = useCallback((nodeId: string, config: Record<string, any>) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, config } } : n));
    // If trigger node config changes the contact_list_id, also update the sequence
    const node = nodes.find((n) => n.id === nodeId);
    if (node?.type === "trigger" && config.contact_list_id) {
      supabase.from("sequences").update({ contact_list_id: config.contact_list_id }).eq("id", id!).then();
    }
    triggerSave();
  }, [nodes, id, triggerSave]);

  const deleteNode = useCallback(async (nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedId(null);
    await supabase.from("sequence_nodes").delete().eq("id", nodeId);
    triggerSave();
  }, [triggerSave]);

  const renameSequence = async (n: string) => {
    setName(n);
    await supabase.from("sequences").update({ name: n }).eq("id", id!);
  };

  const toggleStatus = async () => {
    const next = status === "active" ? "draft" : "active";
    setStatus(next);
    setEdges((eds) => eds.map((e) => ({ ...e, animated: next === "active" })));
    await supabase.from("sequences").update({ status: next }).eq("id", id!);
  };

  const enroll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("enroll-contacts", { body: { sequence_id: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => toast({
      title: "Enrollment complete",
      description: `${d?.enrolled ?? 0} new · ${d?.already_enrolled ?? 0} already enrolled · ${d?.suppressed ?? 0} suppressed · ${d?.no_email ?? 0} no email`,
    }),
    onError: (e: Error) => toast({ title: "Enrollment failed", description: e.message, variant: "destructive" }),
  });

  const triggerNode = nodes.find((n) => n.type === "trigger");
  const contactListId = (triggerNode?.data as any)?.config?.contact_list_id ?? sequence?.contact_list_id ?? null;

  const selectedNode: FlowNode | null = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedId);
    if (!n) return null;
    return { id: n.id, node_type: n.type!, config: (n.data as any).config ?? {} };
  }, [selectedId, nodes]);

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b border-border bg-card shrink-0">
        <div className="flex h-14 items-center justify-between px-4 gap-4">
          <div className="flex items-center gap-2">
            <Link to="/sequences">
              <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Sequences</Button>
            </Link>
            <Send className="h-4 w-4 text-primary ml-2" />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={(e) => renameSequence(e.target.value)}
              className="h-8 max-w-xs font-semibold"
            />
            <span
              onClick={toggleStatus}
              className={`cursor-pointer text-xs px-2 py-1 rounded-full font-medium ${
                status === "active" ? "bg-accent/15 text-accent" : "bg-muted text-muted-foreground"
              }`}
            >
              {status}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1 min-w-[60px]">
              {saveState === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Saving</>}
              {saveState === "saved" && <><CheckCircle2 className="h-3 w-3 text-accent" /> Saved</>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => enroll.mutate()} disabled={enroll.isPending || !contactListId}>
              <Users className="h-3.5 w-3.5 mr-1.5" />
              {enroll.isPending ? "Enrolling…" : "Enroll contacts"}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <NodePalette />
        <div className="flex-1 relative" ref={wrapperRef} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls />
            <MiniMap pannable zoomable className="!bg-card !border-border" />
          </ReactFlow>
        </div>
        {selectedNode && (
          <NodeInspector
            node={selectedNode}
            contactListId={contactListId}
            onChange={(cfg) => updateNodeConfig(selectedNode.id, cfg)}
            onClose={() => setSelectedId(null)}
            onDelete={() => deleteNode(selectedNode.id)}
          />
        )}
      </div>
    </div>
  );
};

const SequenceCanvas = () => (
  <ReactFlowProvider>
    <Inner />
  </ReactFlowProvider>
);

export default SequenceCanvas;
