import { CircleStop } from "lucide-react";
import { NodeProps } from "@xyflow/react";
import { NodeShell } from "./shared";

export const EndNode = ({ selected }: NodeProps) => (
  <NodeShell
    icon={CircleStop}
    title="End"
    subtitle="Branch terminates here"
    colorClass="border-muted-foreground/40 bg-muted/30"
    iconColorClass="bg-muted-foreground"
    showSource={false}
    selected={selected}
  />
);
