import { GitBranch } from "lucide-react";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";

export const ConditionNode = ({ data, selected }: NodeProps) => {
  const cfg = (data?.config ?? {}) as { condition_type?: string; wait_window_hours?: number };
  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-card shadow-card min-w-[220px] transition-all border-pink-500/60 bg-pink-500/5",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background" />
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-pink-500">
            <GitBranch className="h-4 w-4 text-white" />
          </div>
          <div className="font-semibold text-sm">Condition</div>
        </div>
        <div className="text-xs text-muted-foreground pl-9">
          If {cfg.condition_type ?? "opened"} within {cfg.wait_window_hours ?? 24}h
        </div>
        <div className="flex justify-between mt-3 text-[10px] font-medium px-1">
          <span className="text-emerald-600">YES</span>
          <span className="text-rose-600">NO</span>
        </div>
      </div>
      <Handle
        id="true"
        type="source"
        position={Position.Bottom}
        style={{ left: "25%" }}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
      />
      <Handle
        id="false"
        type="source"
        position={Position.Bottom}
        style={{ left: "75%" }}
        className="!w-3 !h-3 !bg-rose-500 !border-2 !border-background"
      />
    </div>
  );
};
