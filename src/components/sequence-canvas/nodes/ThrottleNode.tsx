import { Gauge } from "lucide-react";
import { NodeProps } from "@xyflow/react";
import { NodeShell } from "./shared";

export const ThrottleNode = ({ data, selected }: NodeProps) => {
  const cfg = (data?.config ?? {}) as { max_per_day?: number };
  return (
    <NodeShell
      icon={Gauge}
      title="Daily Limit"
      subtitle={`Max ${cfg.max_per_day ?? 50} sends / day`}
      colorClass="border-emerald-500/60 bg-emerald-500/5"
      iconColorClass="bg-emerald-500"
      selected={selected}
    />
  );
};
