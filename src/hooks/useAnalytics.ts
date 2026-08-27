import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DateRangeKey = "24h" | "7d" | "30d" | "90d" | "all";

export interface AnalyticsFilters {
  range: DateRangeKey;
  sequenceId: string | "all";
  senderId: string | "all";
}

export const rangeToSince = (range: DateRangeKey): Date | null => {
  const now = Date.now();
  const map: Record<DateRangeKey, number | null> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
    all: null,
  };
  const ms = map[range];
  return ms ? new Date(now - ms) : null;
};

export type SentEmailRow = {
  id: string;
  recipient_email: string;
  status: string;
  sent_at: string;
  opened_at: string | null;
  replied_at: string | null;
  sender_id: string | null;
  enrollment_id: string | null;
  subject: string | null;
  tracking_enabled?: boolean | null;
};

export const useSentEmails = (filters: AnalyticsFilters) => {
  return useQuery({
    queryKey: ["analytics-sent", filters],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let q = supabase
        .from("sent_emails")
        .select("id, recipient_email, status, sent_at, opened_at, replied_at, sender_id, enrollment_id, subject, tracking_enabled")
        .order("sent_at", { ascending: false })
        .limit(2000);
      const since = rangeToSince(filters.range);
      if (since) q = q.gte("sent_at", since.toISOString());
      if (filters.senderId !== "all") q = q.eq("sender_id", filters.senderId);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as SentEmailRow[];
      if (filters.sequenceId !== "all") {
        const enrollmentIds = await getSequenceEnrollmentIds(filters.sequenceId);
        const set = new Set(enrollmentIds);
        rows = rows.filter((r) => r.enrollment_id && set.has(r.enrollment_id));
      }
      return rows;
    },
  });
};

const getSequenceEnrollmentIds = async (sequenceId: string) => {
  const { data } = await supabase.from("enrollments").select("id").eq("sequence_id", sequenceId);
  return (data ?? []).map((r) => r.id);
};

export const useSequences = () =>
  useQuery({
    queryKey: ["analytics-sequences"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase.from("sequences").select("id, name, status").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

export const useSenders = () =>
  useQuery({
    queryKey: ["analytics-senders"],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase.from("senders").select("id, from_name, from_email, daily_limit, warmup_enabled, warmup_target");
      return data ?? [];
    },
  });

export const useEnrollments = (filters: AnalyticsFilters) =>
  useQuery({
    queryKey: ["analytics-enrollments", filters],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let q = supabase.from("enrollments").select("id, sequence_id, status, last_error, error_at, created_at");
      if (filters.sequenceId !== "all") q = q.eq("sequence_id", filters.sequenceId);
      const { data } = await q.limit(2000);
      return data ?? [];
    },
  });

export const useUnsubscribed = (filters: AnalyticsFilters) =>
  useQuery({
    queryKey: ["analytics-unsub", filters],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let q = supabase.from("do_not_contact").select("id, created_at");
      const since = rangeToSince(filters.range);
      if (since) q = q.gte("created_at", since.toISOString());
      const { data } = await q;
      return data ?? [];
    },
  });

export const useRecentActivity = (filters: AnalyticsFilters) =>
  useQuery({
    queryKey: ["analytics-activity", filters],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      let q = supabase
        .from("contact_activity")
        .select("id, activity_type, created_at, sequence_id, contact_id, metadata")
        .order("created_at", { ascending: false })
        .limit(20);
      if (filters.sequenceId !== "all") q = q.eq("sequence_id", filters.sequenceId);
      const { data } = await q;
      return data ?? [];
    },
  });

// Step derivation: sent_emails.step_id is null for node-based sequences, so the
// step number is derived from the send order within each enrollment.
export type StepFilter = "all" | "first" | `step-${number}` | "followups";

export const annotateSteps = (rows: SentEmailRow[]): (SentEmailRow & { stepIndex: number })[] => {
  const byEnrollment = new Map<string, SentEmailRow[]>();
  rows.forEach((r) => {
    const key = r.enrollment_id ?? `solo-${r.id}`;
    const arr = byEnrollment.get(key) ?? [];
    arr.push(r);
    byEnrollment.set(key, arr);
  });
  const out: (SentEmailRow & { stepIndex: number })[] = [];
  byEnrollment.forEach((arr) => {
    arr
      .slice()
      .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
      .forEach((r, i) => out.push({ ...r, stepIndex: i + 1 }));
  });
  return out;
};

export const filterByStep = (
  rows: (SentEmailRow & { stepIndex: number })[],
  filter: StepFilter
) => {
  if (filter === "all") return rows;
  if (filter === "first") return rows.filter((r) => r.stepIndex === 1);
  if (filter === "followups") return rows.filter((r) => r.stepIndex > 1);
  const n = Number(filter.replace("step-", ""));
  return rows.filter((r) => r.stepIndex <= n);
};

// Aggregations
export const computeKpis = (rows: SentEmailRow[]) => {

  const failed = rows.filter((r) => r.status === "failed").length;
  const bounced = rows.filter((r) => r.status === "bounced").length;
  const complained = rows.filter((r) => r.status === "complained").length;
  // "Sent" = actually left our infra (sent + later marked bounced/complained/unsubscribed by webhook)
  const sent = rows.filter((r) =>
    r.status === "sent" || r.status === "bounced" || r.status === "complained" || r.status === "unsubscribed"
  ).length;
  const delivered = Math.max(0, sent - bounced);
  const trackableRows = rows.filter((r) =>
    !!r.tracking_enabled &&
    (r.status === "sent" || r.status === "bounced" || r.status === "complained" || r.status === "unsubscribed")
  );
  const trackableDelivered = trackableRows.filter((r) => r.status !== "bounced").length;
  const untracked = Math.max(0, delivered - trackableDelivered);
  const opened = trackableRows.filter((r) => r.opened_at).length;
  const replied = rows.filter((r) => r.replied_at).length;
  return {
    sent,
    delivered,
    failed,
    trackable: trackableDelivered,
    untracked,
    opened,
    replied,
    bounced,
    complained,
    openRate: trackableDelivered ? opened / trackableDelivered : 0,
    replyRate: delivered ? replied / delivered : 0,
    bounceRate: sent ? bounced / sent : 0,
    failRate: (sent + failed) ? failed / (sent + failed) : 0,
  };
};

export const computeDailySeries = (rows: SentEmailRow[], days = 30) => {
  const buckets = new Map<string, { date: string; sent: number; opened: number; replied: number }>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, sent: 0, opened: 0, replied: 0 });
  }
  rows.forEach((r) => {
    const key = r.sent_at.slice(0, 10);
    const b = buckets.get(key);
    if (!b) return;
    b.sent++;
    if (r.opened_at) b.opened++;
    if (r.replied_at) b.replied++;
  });
  return Array.from(buckets.values());
};
