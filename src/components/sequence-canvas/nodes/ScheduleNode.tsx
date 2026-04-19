import { CalendarClock } from "lucide-react";
import { NodeProps } from "@xyflow/react";
import { NodeShell } from "./shared";

export const ScheduleNode = ({ data, selected }: NodeProps) => {
  const cfg = (data?.config ?? {}) as { time_of_day?: string; days?: string[] };
  const days = cfg.days?.length ? cfg.days.join(",") : "every day";
  return (
    <NodeShell
      icon={CalendarClock}
      title="Daily Schedule"
      subtitle={`Run at ${cfg.time_of_day ?? "09:00"} UTC · ${days}`}
      colorClass="border-indigo-500/60 bg-indigo-500/5"
      iconColorClass="bg-indigo-500"
      selected={selected}
    />
  );
};
