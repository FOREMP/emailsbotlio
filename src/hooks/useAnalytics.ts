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
};

export const useSentEmails = (filters: AnalyticsFilters) => {
  return useQuery({
    queryKey: ["analytics-sent", filters],
    queryFn: async () => {
      let q = supabase
        .from("sent_emails")
        .select("id, recipient_email, status, sent_at, opened_at, replied_at, sender_id, enrollment_id, subject")
        .order("sent_at", { ascending: false })
        .limit(5000);
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
    queryFn: async () => {
      const { data } = await supabase.from("sequences").select("id, name, status").order("created_at", { ascending: false });
      return data ?? [];
    },
  });

export const useSenders = () =>
  useQuery({
    queryKey: ["analytics-senders"],
    queryFn: async () => {
      const { data } = await supabase.from("senders").select("id, from_name, from_email, daily_limit, warmup_enabled, warmup_target");
      return data ?? [];
    },
  });

export const useEnrollments = (filters: AnalyticsFilters) =>
  useQuery({
    queryKey: ["analytics-enrollments", filters],
    queryFn: async () => {
      let q = supabase.from("enrollments").select("id, sequence_id, status, last_error, error_at, created_at");
      if (filters.sequenceId !== "all") q = q.eq("sequence_id", filters.sequenceId);
      const { data } = await q.limit(5000);
      return data ?? [];
    },
  });

export const useUnsubscribed = (filters: AnalyticsFilters) =>
  useQuery({
    queryKey: ["analytics-unsub", filters],
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

// Aggregations
export const computeKpis = (rows: SentEmailRow[]) => {
  const sent = rows.length;
  const bounced = rows.filter((r) => r.status === "bounced" || r.status === "failed").length;
  const delivered = sent - bounced;
  const opened = rows.filter((r) => r.opened_at).length;
  const replied = rows.filter((r) => r.replied_at).length;
  return {
    sent,
    delivered,
    opened,
    replied,
    bounced,
    openRate: delivered ? opened / delivered : 0,
    replyRate: delivered ? replied / delivered : 0,
    bounceRate: sent ? bounced / sent : 0,
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
