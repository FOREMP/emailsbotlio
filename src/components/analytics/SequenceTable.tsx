import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { SentEmailRow } from "@/hooks/useAnalytics";

interface Sequence { id: string; name: string; status: string }
interface Enrollment { id: string; sequence_id: string; status: string }

interface Props {
  sequences: Sequence[];
  enrollments: Enrollment[];
  rows: SentEmailRow[];
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

type SortKey = "name" | "status" | "sent" | "openRate" | "replyRate" | "bounceRate" | "active";
type SortDir = "asc" | "desc";

export const SequenceTable = ({ sequences, enrollments, rows }: Props) => {
  const [sortKey, setSortKey] = useState<SortKey>("sent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const enrollMap = useMemo(
    () => new Map(enrollments.map((e) => [e.id, e.sequence_id])),
    [enrollments]
  );

  const stats = useMemo(() => {
    return sequences.map((seq) => {
      const seqRows = rows.filter((r) => r.enrollment_id && enrollMap.get(r.enrollment_id) === seq.id);
      const sent = seqRows.length;
      const bounced = seqRows.filter((r) => r.status === "bounced").length;
      const delivered = sent - bounced;
      const trackableDelivered = seqRows.filter((r) => !!r.tracking_enabled && r.status !== "bounced").length;
      const opened = seqRows.filter((r) => !!r.tracking_enabled && !!r.opened_at).length;
      const replied = seqRows.filter((r) => r.replied_at).length;
      const active = enrollments.filter((e) => e.sequence_id === seq.id && e.status === "active").length;
      return {
        ...seq,
        sent,
        openRate: trackableDelivered ? opened / trackableDelivered : 0,
        replyRate: delivered ? replied / delivered : 0,
        bounceRate: sent ? bounced / sent : 0,
        active,
      };
    });
  }, [sequences, rows, enrollments, enrollMap]);

  const sorted = useMemo(() => {
    const arr = [...stats];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [stats, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns default to desc (highest first); text to asc
      setSortDir(["name", "status"].includes(key) ? "asc" : "desc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="inline h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="inline h-3 w-3 ml-1" />
      : <ArrowDown className="inline h-3 w-3 ml-1" />;
  };

  const headerBtn = (k: SortKey, label: string, align: "left" | "right" = "left") => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className={`font-medium hover:text-foreground transition-colors ${align === "right" ? "ml-auto" : ""} ${sortKey === k ? "text-foreground" : ""}`}
    >
      {label}<SortIcon k={k} />
    </button>
  );

  return (
    <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      <div className="p-6 pb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">Sequence Performance</h2>
          <p className="text-xs text-muted-foreground">Per-sequence engagement — click a column to sort</p>
        </div>
        <p className="text-xs text-muted-foreground hidden sm:block">
          Sorted by <span className="text-foreground font-medium">{sortKey}</span> ({sortDir})
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-6 py-2">{headerBtn("name", "Sequence")}</th>
              <th className="text-left px-3 py-2">{headerBtn("status", "Status")}</th>
              <th className="text-right px-3 py-2">{headerBtn("sent", "Sent", "right")}</th>
              <th className="text-right px-3 py-2">{headerBtn("openRate", "Open", "right")}</th>
              <th className="text-right px-3 py-2">{headerBtn("replyRate", "Reply", "right")}</th>
              <th className="text-right px-3 py-2">{headerBtn("bounceRate", "Bounce", "right")}</th>
              <th className="text-right px-6 py-2">{headerBtn("active", "Active", "right")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">No sequences yet.</td></tr>
            ) : sorted.map((s) => (
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
