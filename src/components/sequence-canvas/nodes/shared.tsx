import { Handle, Position } from "@xyflow/react";
import { LucideIcon } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface NodeShellProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  colorClass: string; // e.g. "border-emerald-500/60 bg-emerald-500/10"
  iconColorClass: string;
  showTarget?: boolean;
  showSource?: boolean;
  selected?: boolean;
  children?: ReactNode;
}

export const NodeShell = ({
  icon: Icon,
  title,
  subtitle,
  colorClass,
  iconColorClass,
  showTarget = true,
  showSource = true,
  selected,
  children,
}: NodeShellProps) => (
  <div
    className={cn(
      "rounded-xl border-2 bg-card shadow-card min-w-[200px] transition-all",
      colorClass,
      selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
    )}
  >
    {showTarget && (
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background" />
    )}
    <div className="p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-md", iconColorClass)}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div className="font-semibold text-sm">{title}</div>
      </div>
      {subtitle && <div className="text-xs text-muted-foreground line-clamp-2 pl-9">{subtitle}</div>}
      {children}
    </div>
    {showSource && (
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background" />
    )}
  </div>
);
