import { Link } from "react-router-dom";
import { SentEmailRow } from "@/hooks/useAnalytics";

interface Sequence { id: string; name: string; status: string }
interface Enrollment { id: string; sequence_id: string; status: string }

interface Props {
  sequences: Sequence[];
  enrollments: Enrollment[];
  rows: SentEmailRow[];
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

export const SequenceTable = ({ sequences, enrollments, rows }: Props) => {
  // Map enrollment_id -> sequence_id
  const enrollMap = new Map(enrollments.map((e) => [e.id, e.sequence_id]));

  const stats = sequences.map((seq) => {
    const seqRows = rows.filter((r) => r.enrollment_id && enrollMap.get(r.enrollment_id) === seq.id);
    const sent = seqRows.length;
    const bounced = seqRows.filter((r) => r.status === "bounced" || r.status === "failed").length;
    const delivered = sent - bounced;
    const opened = seqRows.filter((r) => r.opened_at).length;
    const replied = seqRows.filter((r) => r.replied_at).length;
    const active = enrollments.filter((e) => e.sequence_id === seq.id && e.status === "active").length;
    return {
      ...seq,
      sent,
      openRate: delivered ? opened / delivered : 0,
      replyRate: delivered ? replied / delivered : 0,
      bounceRate: sent ? bounced / sent : 0,
      active,
    };
  });

  return (
    <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      <div className="p-6 pb-3">
        <h2 className="font-semibold">Sequence Performance</h2>
        <p className="text-xs text-muted-foreground">Per-sequence engagement</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-6 py-2 font-medium">Sequence</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium">Sent</th>
              <th className="text-right px-3 py-2 font-medium">Open</th>
              <th className="text-right px-3 py-2 font-medium">Reply</th>
              <th className="text-right px-3 py-2 font-medium">Bounce</th>
              <th className="text-right px-6 py-2 font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {stats.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No sequences yet.</td></tr>
            ) : stats.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-6 py-3"><Link to={`/sequences/${s.id}`} className="font-medium hover:text-primary">{s.name}</Link></td>
                <td className="px-3 py-3 text-xs text-muted-foreground capitalize">{s.status}</td>
                <td className="px-3 py-3 text-right tabular-nums">{s.sent}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtPct(s.openRate)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtPct(s.replyRate)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{fmtPct(s.bounceRate)}</td>
                <td className="px-6 py-3 text-right tabular-nums">{s.active}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
