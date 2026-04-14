import { Button } from "@/components/ui/button";
import { Brain, Plus, Star, BarChart3, MessageSquareText, TrendingUp, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const { data: sourcesCount = 0 } = useQuery({
    queryKey: ["review-sources-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("review_sources")
        .select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: reviewsCount = 0 } = useQuery({
    queryKey: ["reviews-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("reviews")
        .select("*", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const { data: recentReviews = [] } = useQuery({
    queryKey: ["recent-reviews"],
    queryFn: async () => {
      const { data } = await supabase
        .from("reviews")
        .select("*")
        .order("review_date", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const sentimentColor = (label: string | null) => {
    if (label === "positive") return "text-accent";
    if (label === "negative") return "text-destructive";
    return "text-muted-foreground";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <Brain className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>ReviewBrain</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[200px]">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1.5" />
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Your review intelligence at a glance.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Review Sources", value: sourcesCount.toString(), icon: TrendingUp },
            { label: "Total Reviews", value: reviewsCount.toString(), icon: Star },
            { label: "Avg. Rating", value: "—", icon: BarChart3 },
            { label: "AI Responses", value: "0", icon: MessageSquareText },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-4 shadow-card">
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
                <s.icon className="h-4 w-4" />
                {s.label}
              </div>
              <div className="text-2xl font-bold">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <div className="rounded-xl border border-border bg-card shadow-card p-6">
            <h2 className="font-semibold mb-2">Review Sources</h2>
            <p className="text-muted-foreground text-sm mb-4">Connect Trustpilot, Google, or import reviews manually.</p>
            <Button onClick={() => navigate("/sources")} className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4 mr-1.5" /> Manage Sources
            </Button>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6">
            <h2 className="font-semibold mb-2">AI Insights</h2>
            <p className="text-muted-foreground text-sm mb-4">View sentiment trends, theme breakdowns, and action items.</p>
            <Button variant="outline" disabled>
              <BarChart3 className="h-4 w-4 mr-1.5" /> View Insights (coming soon)
            </Button>
          </div>
        </div>

        {/* Recent Reviews */}
        <div className="rounded-xl border border-border bg-card shadow-card p-6">
          <h2 className="font-semibold mb-4">Recent Reviews</h2>
          {recentReviews.length === 0 ? (
            <p className="text-muted-foreground text-sm">No reviews yet. Connect a review source to get started.</p>
          ) : (
            <div className="space-y-4">
              {recentReviews.map((review) => (
                <div key={review.id} className="flex items-start gap-3 border-b border-border pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${i < (review.rating ?? 0) ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/30"}`}
                      />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{review.author_name || "Anonymous"}</span>
                      <span className={`text-xs font-medium ${sentimentColor(review.sentiment_label)}`}>
                        {review.sentiment_label || "unanalyzed"}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{review.review_text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;