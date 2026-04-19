import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { ArrowLeft, LogOut, Send, Loader2, CheckCircle2 } from "lucide-react";
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
import { ThrottleNode } from "@/components/sequence-canvas/nodes/ThrottleNode";
import { ScheduleNode } from "@/components/sequence-canvas/nodes/ScheduleNode";

const nodeTypes = {
  trigger: TriggerNode,
  send_email: SendEmailNode,
  wait: WaitNode,
  log_activity: LogActivityNode,
  condition: ConditionNode,
  end: EndNode,
  throttle: ThrottleNode,
  schedule: ScheduleNode,
};

const defaultConfig = (type: string): Record<string, any> => {
  switch (type) {
    case "send_email": return { mode: "ai", sender_id: "rotate", prompt: "", send_delay_seconds: 60, send_jitter_seconds: 30 };
    case "wait": return { duration: 1, unit: "days" };
    case "log_activity": return { activity_type: "contacted", note: "" };
    case "condition": return { condition_type: "opened", wait_window_hours: 24 };
    case "throttle": return { max_per_day: 50 };
    case "schedule": return { time_of_day: "09:00", days: [] };
    default: return {};
  }
};

const Inner = () => {
  const { id } = useParams();
  const { user, signOut } = useAuth();
  const { screenToFlowPosition } = useReactFlow();
  const reactFlow = useReactFlow();
  const qc = useQueryClient();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("draft");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const saveTimer = useRef<number | null>(null);
  const dirty = useRef(false);
  const pendingSave = useRef(false);
  const hasFitView = useRef(false);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

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

  useEffect(() => {
    if (!sequence) return;
    setName(sequence.name);
    setStatus(sequence.status);
  }, [sequence]);

  useEffect(() => {
    if (dirty.current || pendingSave.current) return;

    const nextNodes = dbNodes.map((n: any) => ({
      id: n.id,
      type: n.node_type,
      position: { x: n.position_x, y: n.position_y },
      data: { config: n.config, node_type: n.node_type },
    }));

    const nextEdges = dbEdges.map((e: any) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      sourceHandle: e.source_handle === "default" ? null : e.source_handle,
      animated: sequence?.status === "active",
    }));

    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [dbNodes, dbEdges, sequence?.status]);

  useEffect(() => {
    if (hasFitView.current) return;
    if (nodes.length === 0) return;
    hasFitView.current = true;
    requestAnimationFrame(() => reactFlow.fitView({ padding: 0.2, duration: 200 }));
  }, [nodes.length, reactFlow]);

  const performSave = useCallback(async (nodesToSave: Node[], edgesToSave: Edge[]) => {
    if (!id || !user) return;
    pendingSave.current = true;
    setSaveState("saving");

    try {
      // 1. Reconcile nodes: delete any DB rows not present in canvas
      const { data: existing, error: fetchErr } = await supabase
        .from("sequence_nodes")
        .select("id")
        .eq("sequence_id", id);
      if (fetchErr) throw fetchErr;

      const canvasIds = new Set(nodesToSave.map((n) => n.id));
      const toDelete = (existing ?? []).filter((r) => !canvasIds.has(r.id)).map((r) => r.id);

      if (toDelete.length > 0) {
        const { error } = await supabase.from("sequence_nodes").delete().in("id", toDelete);
        if (error) throw error;
      }

      // 2. Upsert remaining nodes
      const nodePayload = nodesToSave.map((n) => ({
        id: n.id,
        sequence_id: id,
        user_id: user.id,
        node_type: (n.data as any).node_type ?? n.type!,
        position_x: n.position.x,
        position_y: n.position.y,
        config: (n.data as any).config ?? {},
      }));

      if (nodePayload.length > 0) {
        const { error } = await supabase.from("sequence_nodes").upsert(nodePayload, { onConflict: "id" });
        if (error) throw error;
      }

      // 3. Replace edges
      const { error: deleteEdgesError } = await supabase.from("sequence_edges").delete().eq("sequence_id", id);
      if (deleteEdgesError) throw deleteEdgesError;

      const edgePayload = edgesToSave.map((e) => ({
        sequence_id: id,
        user_id: user.id,
        source_node_id: e.source,
        target_node_id: e.target,
        source_handle: e.sourceHandle ?? "default",
      }));

      if (edgePayload.length > 0) {
        const { error } = await supabase.from("sequence_edges").insert(edgePayload);
        if (error) throw error;
      }

      setSaveState("saved");
      dirty.current = false;
      window.setTimeout(() => setSaveState("idle"), 1200);
    } catch (e: any) {
      setSaveState("idle");
      dirty.current = false;
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      pendingSave.current = false;
    }
  }, [id, user]);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!dirty.current) return;
    await performSave(nodesRef.current, edgesRef.current);
  }, [performSave]);

  useEffect(() => {
    flushRef.current = flushSave;
  }, [flushSave]);

  // Flush on unmount, tab hide, and page unload
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushRef.current();
    };
    const onBeforeUnload = () => { flushRef.current(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      flushRef.current();
    };
  }, []);

  const triggerSave = useCallback((nextNodes?: Node[], nextEdges?: Edge[]) => {
    if (!id || !user) return;

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    dirty.current = true;
    setSaveState("saving");

    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const nodesToSave = nextNodes ?? nodesRef.current;
      const edgesToSave = nextEdges ?? edgesRef.current;
      performSave(nodesToSave, edgesToSave);
    }, 800);
  }, [id, user, performSave]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current);
      nodesRef.current = next;
      if (changes.some((c) => c.type === "position" || c.type === "remove")) {
        triggerSave(next, edgesRef.current);
      }
      return next;
    });
  }, [triggerSave]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current);
      edgesRef.current = next;
      if (changes.some((c) => c.type === "remove")) {
        triggerSave(nodesRef.current, next);
      }
      return next;
    });
  }, [triggerSave]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges((current) => {
      const next = addEdge({ ...conn, animated: status === "active" }, current);
      edgesRef.current = next;
      triggerSave(nodesRef.current, next);
      return next;
    });
  }, [triggerSave, status]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/reactflow");
    if (!type || !id || !user) return;

    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const config = defaultConfig(type);
    const { data, error } = await supabase
      .from("sequence_nodes")
      .insert({
        sequence_id: id,
        user_id: user.id,
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

    setNodes((current) => {
      const next = [
        ...current,
        {
          id: data.id,
          type,
          position,
          data: { config, node_type: type },
        },
      ];
      nodesRef.current = next;
      return next;
    });
  }, [screenToFlowPosition, id, user]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const updateNodeConfig = useCallback((nodeId: string, config: Record<string, any>) => {
    const nextNodes = nodesRef.current.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, config } } : n);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);

    const node = nextNodes.find((n) => n.id === nodeId);
    if (node?.type === "trigger" && config.contact_list_id) {
      supabase.from("sequences").update({ contact_list_id: config.contact_list_id }).eq("id", id!).then();
    }

    triggerSave(nextNodes, edgesRef.current);
  }, [id, triggerSave]);

  const deleteNode = useCallback((nodeId: string) => {
    const nextNodes = nodesRef.current.filter((n) => n.id !== nodeId);
    const nextEdges = edgesRef.current.filter((e) => e.source !== nodeId && e.target !== nodeId);

    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedId(null);

    triggerSave(nextNodes, nextEdges);
  }, [triggerSave]);

  const renameSequence = async (n: string) => {
    setName(n);
    await supabase.from("sequences").update({ name: n }).eq("id", id!);
  };

  const toggleStatus = async () => {
    const next = status === "active" ? "draft" : "active";
    setStatus(next);
    setEdges((current) => {
      const updated = current.map((e) => ({ ...e, animated: next === "active" }));
      edgesRef.current = updated;
      return updated;
    });
    await supabase.from("sequences").update({ status: next }).eq("id", id!);
  };

  const publish = useMutation({
    mutationFn: async () => {
      if (status !== "active") {
        await supabase.from("sequences").update({ status: "active" }).eq("id", id!);
        setStatus("active");
        setEdges((current) => {
          const updated = current.map((e) => ({ ...e, animated: true }));
          edgesRef.current = updated;
          return updated;
        });
      }
      const { data, error } = await supabase.functions.invoke("enroll-contacts", { body: { sequence_id: id } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => toast({
      title: "Sequence published 🚀",
      description: `Now active. ${d?.enrolled ?? 0} new · ${d?.already_enrolled ?? 0} already enrolled · ${d?.suppressed ?? 0} suppressed · ${d?.no_email ?? 0} no email`,
    }),
    onError: (e: Error) => toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
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
            <Button size="sm" onClick={() => publish.mutate()} disabled={publish.isPending || !contactListId} className="gradient-primary border-0 text-primary-foreground">
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {publish.isPending ? "Publishing…" : status === "active" ? "Re-publish" : "Publish"}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <NodePalette />
        <div className="flex-1 relative" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
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
