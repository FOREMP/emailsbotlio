import { Send, CheckCircle2, MailOpen, Reply, AlertTriangle, UserMinus } from "lucide-react";

interface Props {
  kpis: {
    sent: number;
    delivered: number;
    opened: number;
    replied: number;
    bounced: number;
    openRate: number;
    replyRate: number;
    bounceRate: number;
  };
  unsubscribed: number;
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

export const KpiCards = ({ kpis, unsubscribed }: Props) => {
  const items = [
    { label: "Sent", value: kpis.sent.toLocaleString(), icon: Send, sub: null },
    { label: "Delivered", value: kpis.delivered.toLocaleString(), icon: CheckCircle2, sub: null },
    { label: "Opened", value: kpis.opened.toLocaleString(), icon: MailOpen, sub: fmtPct(kpis.openRate) },
    { label: "Replied", value: kpis.replied.toLocaleString(), icon: Reply, sub: fmtPct(kpis.replyRate) },
    { label: "Bounced", value: kpis.bounced.toLocaleString(), icon: AlertTriangle, sub: fmtPct(kpis.bounceRate) },
    { label: "Unsubscribed", value: unsubscribed.toLocaleString(), icon: UserMinus, sub: null },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
            <i.icon className="h-3.5 w-3.5" />
            {i.label}
          </div>
          <div className="text-2xl font-bold">{i.value}</div>
          {i.sub && <div className="text-xs text-muted-foreground mt-1">{i.sub}</div>}
        </div>
      ))}
    </div>
  );
};
