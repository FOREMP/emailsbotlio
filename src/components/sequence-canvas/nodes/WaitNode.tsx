import { Clock } from "lucide-react";
import { NodeProps } from "@xyflow/react";
import { NodeShell } from "./shared";

export const WaitNode = ({ data, selected }: NodeProps) => {
  const cfg = (data?.config ?? {}) as { duration?: number; unit?: string };
  return (
    <NodeShell
      icon={Clock}
      title="Wait"
      subtitle={`${cfg.duration ?? 1} ${cfg.unit ?? "days"}`}
      colorClass="border-amber-500/60 bg-amber-500/5"
      iconColorClass="bg-amber-500"
      selected={selected}
    />
  );
};
