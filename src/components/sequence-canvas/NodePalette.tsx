import { Mail, Clock, Activity, GitBranch, CircleStop, Gauge } from "lucide-react";

const items = [
  { type: "send_email", label: "Send Email", icon: Mail, desc: "AI or template", color: "bg-blue-500" },
  { type: "throttle", label: "Daily Limit", icon: Gauge, desc: "Cap sends/day", color: "bg-emerald-500" },
  { type: "wait", label: "Wait", icon: Clock, desc: "Delay branch", color: "bg-amber-500" },
  { type: "log_activity", label: "Log Activity", icon: Activity, desc: "Record event", color: "bg-purple-500" },
  { type: "condition", label: "Condition", icon: GitBranch, desc: "Branch on event", color: "bg-pink-500" },
  { type: "end", label: "End", icon: CircleStop, desc: "Stop branch", color: "bg-muted-foreground" },
];

export const NodePalette = () => {
  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData("application/reactflow", type);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="w-64 border-r border-border bg-card overflow-y-auto">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold text-sm">Nodes</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Drag onto canvas</p>
      </div>
      <div className="p-3 space-y-2">
        {items.map((it) => (
          <div
            key={it.type}
            draggable
            onDragStart={(e) => onDragStart(e, it.type)}
            className="flex items-center gap-2 p-2 rounded-lg border border-border bg-background hover:border-primary/50 hover:shadow-card cursor-grab active:cursor-grabbing transition-all"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-md ${it.color}`}>
              <it.icon className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{it.label}</div>
              <div className="text-[11px] text-muted-foreground">{it.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
