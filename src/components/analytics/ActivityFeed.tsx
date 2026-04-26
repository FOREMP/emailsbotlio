import { Mail, MailOpen, Reply, AlertTriangle, UserMinus, Activity } from "lucide-react";

interface ActivityRow {
  id: string;
  activity_type: string;
  created_at: string;
  sequence_id: string | null;
  contact_id: string;
  metadata: any;
}

const iconFor = (t: string) => {
  if (t.includes("open")) return MailOpen;
  if (t.includes("repl")) return Reply;
  if (t.includes("bounce") || t.includes("fail")) return AlertTriangle;
  if (t.includes("unsub")) return UserMinus;
  if (t.includes("sent") || t.includes("send")) return Mail;
  return Activity;
};

const colorFor = (t: string) => {
  if (t.includes("open") || t.includes("repl")) return "text-accent";
  if (t.includes("bounce") || t.includes("fail") || t.includes("unsub")) return "text-destructive";
  return "text-muted-foreground";
};

export const ActivityFeed = ({ items }: { items: ActivityRow[] }) => (
  <div className="rounded-xl border border-border bg-card shadow-card p-6">
    <h2 className="font-semibold mb-1">Recent Activity</h2>
    <p className="text-xs text-muted-foreground mb-4">Last 20 events</p>
    {items.length === 0 ? (
      <p className="text-sm text-muted-foreground text-center py-6">No activity yet.</p>
    ) : (
      <div className="space-y-3">
        {items.map((a) => {
          const Icon = iconFor(a.activity_type);
          return (
            <div key={a.id} className="flex items-center gap-3 text-sm border-b border-border last:border-0 pb-3 last:pb-0">
              <Icon className={`h-4 w-4 shrink-0 ${colorFor(a.activity_type)}`} />
              <div className="flex-1 min-w-0">
                <div className="font-medium capitalize truncate">{a.activity_type.replace(/_/g, " ")}</div>
                <div className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</div>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);
