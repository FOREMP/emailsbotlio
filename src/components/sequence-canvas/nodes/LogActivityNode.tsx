import { Activity } from "lucide-react";
import { NodeProps } from "@xyflow/react";
import { NodeShell } from "./shared";

export const LogActivityNode = ({ data, selected }: NodeProps) => {
  const cfg = (data?.config ?? {}) as { activity_type?: string; note?: string };
  return (
    <NodeShell
      icon={Activity}
      title="Log Activity"
      subtitle={cfg.activity_type ? `${cfg.activity_type}${cfg.note ? ` — ${cfg.note}` : ""}` : "Record an event"}
      colorClass="border-purple-500/60 bg-purple-500/5"
      iconColorClass="bg-purple-500"
      selected={selected}
    />
  );
};
