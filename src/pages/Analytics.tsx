import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AnalyticsFilters,
  DateRangeKey,
  computeDailySeries,
  computeKpis,
  useEnrollments,
  useRecentActivity,
  useSenders,
  useSentEmails,
  useSequences,
  useUnsubscribed,
} from "@/hooks/useAnalytics";
import { KpiCards } from "@/components/analytics/KpiCards";
import { VolumeTrendChart } from "@/components/analytics/VolumeTrendChart";
import { FunnelCard } from "@/components/analytics/FunnelCard";
import { SequenceTable } from "@/components/analytics/SequenceTable";
import { SenderTable } from "@/components/analytics/SenderTable";
import { ActivityFeed } from "@/components/analytics/ActivityFeed";

const RANGE_OPTIONS: { value: DateRangeKey; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const Analytics = () => {
  const [filters, setFilters] = useState<AnalyticsFilters>({ range: "30d", sequenceId: "all", senderId: "all" });

  const { data: sequences = [] } = useSequences();
  const { data: senders = [] } = useSenders();
  const { data: rows = [], isLoading } = useSentEmails(filters);
  const { data: enrollments = [] } = useEnrollments({ ...filters, sequenceId: "all" });
  const { data: unsubs = [] } = useUnsubscribed(filters);
  const { data: activity = [] } = useRecentActivity(filters);

  const kpis = useMemo(() => computeKpis(rows), [rows]);
  const days = filters.range === "24h" ? 1 : filters.range === "7d" ? 7 : filters.range === "90d" ? 90 : 30;
  const series = useMemo(() => computeDailySeries(rows, days), [rows, days]);

  return (
    <>
      <div className="mb-6 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground text-sm mt-1">Email performance across your sequences and senders.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={filters.range} onValueChange={(v) => setFilters((f) => ({ ...f, range: v as DateRangeKey }))}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.sequenceId} onValueChange={(v) => setFilters((f) => ({ ...f, sequenceId: v }))}>
            <SelectTrigger className="w-[180px]"><SelectValue placeholder="Sequence" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sequences</SelectItem>
              {sequences.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.senderId} onValueChange={(v) => setFilters((f) => ({ ...f, senderId: v }))}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Sender" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All senders</SelectItem>
              {senders.map((s) => <SelectItem key={s.id} value={s.id}>{s.from_email}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-6">
        <KpiCards kpis={kpis} unsubscribed={unsubs.length} />

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2"><VolumeTrendChart data={series} /></div>
          <FunnelCard kpis={kpis} />
        </div>

        <SequenceTable sequences={sequences} enrollments={enrollments} rows={rows} />
        <SenderTable senders={senders} rows={rows} />
        <ActivityFeed items={activity as any} />

        {isLoading && <p className="text-xs text-muted-foreground text-center">Loading…</p>}
      </div>
    </>
  );
};

export default Analytics;
