import { Mail } from "lucide-react";
import { NodeProps } from "@xyflow/react";
import { NodeShell } from "./shared";

export const SendEmailNode = ({ data, selected }: NodeProps) => {
  const cfg = (data?.config ?? {}) as { mode?: string; subject?: string; subject_prompt?: string; subject_hint?: string; prompt?: string };
  const sub = cfg.mode === "ai"
    ? ((cfg.subject_prompt ?? cfg.subject_hint)?.slice(0, 60) || cfg.prompt?.slice(0, 60) || "AI-generated email")
    : (cfg.subject || "Static template");
  return (
    <NodeShell
      icon={Mail}
      title="Send Email"
      subtitle={sub}
      colorClass="border-blue-500/60 bg-blue-500/5"
      iconColorClass="bg-blue-500"
      selected={selected}
    />
  );
};
