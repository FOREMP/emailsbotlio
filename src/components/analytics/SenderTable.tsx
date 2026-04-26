import { SentEmailRow } from "@/hooks/useAnalytics";

interface Sender {
  id: string;
  from_name: string;
  from_email: string;
  daily_limit: number;
  warmup_enabled: boolean;
  warmup_target: number;
}

interface Props {
  senders: Sender[];
  rows: SentEmailRow[];
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

export const SenderTable = ({ senders, rows }: Props) => {
  const stats = senders.map((s) => {
    const senderRows = rows.filter((r) => r.sender_id === s.id);
    const sent = senderRows.length;
    const bounced = senderRows.filter((r) => r.status === "bounced" || r.status === "failed").length;
    const delivered = sent - bounced;
    const opened = senderRows.filter((r) => r.opened_at).length;
    const replied = senderRows.filter((r) => r.replied_at).length;
    const sentToday = senderRows.filter((r) => new Date(r.sent_at) >= todayStart).length;
    return {
      ...s,
      sent,
      sentToday,
      openRate: delivered ? opened / delivered : 0,
      replyRate: delivered ? replied / delivered : 0,
      bounceRate: sent ? bounced / sent : 0,
    };
  });

  return (
    <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      <div className="p-6 pb-3">
        <h2 className="font-semibold">Sender Performance</h2>
        <p className="text-xs text-muted-foreground">Volume and reputation per inbox</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-6 py-2 font-medium">Sender</th>
              <th className="text-right px-3 py-2 font-medium">Today</th>
              <th className="text-right px-3 py-2 font-medium">Limit</th>
              <th className="text-right px-3 py-2 font-medium">Total</th>
              <th className="text-right px-3 py-2 font-medium">Open</th>
              <th className="text-right px-3 py-2 font-medium">Reply</th>
              <th className="text-right px-6 py-2 font-medium">Bounce</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No senders yet.</td></tr>
            ) : stats.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-6 py-3">
                  <div className="font-medium">{s.from_name}</div>
                  <div className="text-xs text-muted-foreground">{s.from_email}</div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{s.sentToday}</td>
                <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{s.daily_limit}</td>
                <td className="px-3 py-3 text-right tabular-nums">{s.sent}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtPct(s.openRate)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtPct(s.replyRate)}</td>
                <td className="px-6 py-3 text-right tabular-nums">{fmtPct(s.bounceRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
