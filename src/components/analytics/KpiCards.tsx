import { Send, CheckCircle2, MailOpen, Reply, AlertTriangle, UserMinus, XCircle, Flag } from "lucide-react";

interface Props {
  kpis: {
    sent: number;
    delivered: number;
    failed: number;
    opened: number;
    replied: number;
    bounced: number;
    complained: number;
    openRate: number;
    replyRate: number;
    bounceRate: number;
    failRate: number;
  };
  unsubscribed: number;
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

export const KpiCards = ({ kpis, unsubscribed }: Props) => {
  const items = [
    { label: "Sent", value: kpis.sent.toLocaleString(), icon: Send, sub: null, hint: "Emails accepted by the receiving server" },
    { label: "Delivered", value: kpis.delivered.toLocaleString(), icon: CheckCircle2, sub: null, hint: "Sent minus bounced" },
    { label: "Failed", value: kpis.failed.toLocaleString(), icon: XCircle, sub: fmtPct(kpis.failRate), hint: "Rejected before sending (invalid address, no sender, etc.)" },
    { label: "Bounced", value: kpis.bounced.toLocaleString(), icon: AlertTriangle, sub: fmtPct(kpis.bounceRate), hint: "Receiving server rejected after delivery attempt" },
    { label: "Complaints", value: kpis.complained.toLocaleString(), icon: Flag, sub: null, hint: "Marked as spam by the recipient" },
    { label: "Opened", value: kpis.opened.toLocaleString(), icon: MailOpen, sub: "tracking off", hint: "Open tracking is disabled during warmup" },
    { label: "Replied", value: kpis.replied.toLocaleString(), icon: Reply, sub: "tracking off", hint: "Replies go to your inbox; webhook tracking disabled" },
    { label: "Unsubscribed", value: unsubscribed.toLocaleString(), icon: UserMinus, sub: null, hint: null },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-xl border border-border bg-card p-4 shadow-card" title={i.hint ?? undefined}>
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
