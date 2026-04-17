import { Zap } from "lucide-react";
import { NodeProps } from "@xyflow/react";
import { NodeShell } from "./shared";

export const TriggerNode = ({ data, selected }: NodeProps) => {
  const cfg = (data?.config ?? {}) as { contact_list_name?: string };
  return (
    <NodeShell
      icon={Zap}
      title="Trigger"
      subtitle={cfg.contact_list_name ? `List: ${cfg.contact_list_name}` : "Pick a contact list"}
      colorClass="border-emerald-500/60 bg-emerald-500/5"
      iconColorClass="bg-emerald-500"
      showTarget={false}
      selected={selected}
    />
  );
};
