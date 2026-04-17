import { Button } from "@/components/ui/button";
import { Send, Users, Mail, Layers, FileSpreadsheet, Inbox, LogOut, Plus, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const Dashboard = () => {
  const { user, signOut } = useAuth();

  const counts = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: async () => {
      const [contacts, lists, senders, sequences, sent, files] = await Promise.all([
        supabase.from("contacts").select("*", { count: "exact", head: true }),
        supabase.from("contact_lists").select("*", { count: "exact", head: true }),
        supabase.from("senders").select("*", { count: "exact", head: true }),
        supabase.from("sequences").select("*", { count: "exact", head: true }),
        supabase.from("sent_emails").select("*", { count: "exact", head: true }),
        supabase.from("imported_files").select("*", { count: "exact", head: true }),
      ]);
      return {
        contacts: contacts.count ?? 0,
        lists: lists.count ?? 0,
        senders: senders.count ?? 0,
        sequences: sequences.count ?? 0,
        sent: sent.count ?? 0,
        files: files.count ?? 0,
      };
    },
  });

  const { data: recentFiles = [] } = useQuery({
    queryKey: ["dashboard-recent-files"],
    queryFn: async () => {
      const { data } = await supabase
        .from("imported_files")
        .select("id, file_name, imported_count, created_at, list_id")
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const { data: recentSends = [] } = useQuery({
    queryKey: ["dashboard-recent-sends"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sent_emails")
        .select("id, recipient_email, subject, status, sent_at")
        .order("sent_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });

  const stats = [
    { label: "Contacts", value: counts.data?.contacts ?? 0, icon: Users, to: "/contacts" },
    { label: "Lists", value: counts.data?.lists ?? 0, icon: Layers, to: "/contacts" },
    { label: "Senders", value: counts.data?.senders ?? 0, icon: Mail, to: "/senders" },
    { label: "Sequences", value: counts.data?.sequences ?? 0, icon: Send, to: "/sequences" },
    { label: "Emails Sent", value: counts.data?.sent ?? 0, icon: Inbox, to: "/dashboard" },
    { label: "Files Uploaded", value: counts.data?.files ?? 0, icon: FileSpreadsheet, to: "/files" },
  ];

  const quickActions = [
    { label: "Import Contacts", desc: "Upload a CSV or Excel file and map columns to variables.", to: "/contacts", icon: Users },
    { label: "Connect Sender Domain", desc: "Verify a domain to send from your own brand.", to: "/senders", icon: Mail },
    { label: "View Uploaded Files", desc: "Browse every file you've imported and its extracted data.", to: "/files", icon: FileSpreadsheet },
  ];

  const statusColor = (s: string) => {
    if (s === "sent" || s === "delivered") return "text-accent";
    if (s === "failed" || s === "bounced") return "text-destructive";
    return "text-muted-foreground";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <Send className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>MailxSend</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[200px]">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4 mr-1.5" />Log out</Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Your outreach at a glance.</p>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-8">
          {stats.map((s) => (
            <Link key={s.label} to={s.to} className="rounded-xl border border-border bg-card p-4 shadow-card hover:shadow-elevated hover:border-primary/30 transition-all">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                <s.icon className="h-3.5 w-3.5" />
                {s.label}
              </div>
              <div className="text-2xl font-bold">{s.value}</div>
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          {quickActions.map((a) => (
            <Link key={a.label} to={a.to} className="rounded-xl border border-border bg-card shadow-card p-5 hover:shadow-elevated hover:border-primary/30 transition-all group">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
                  <a.icon className="h-4 w-4 text-primary-foreground" />
                </div>
                <h2 className="font-semibold">{a.label}</h2>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{a.desc}</p>
              <span className="inline-flex items-center text-xs text-primary font-medium group-hover:gap-2 transition-all gap-1">
                Open <ArrowRight className="h-3 w-3" />
              </span>
            </Link>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Recent uploads */}
          <div className="rounded-xl border border-border bg-card shadow-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2"><FileSpreadsheet className="h-4 w-4" /> Recent Uploads</h2>
              <Link to="/files" className="text-xs text-primary font-medium hover:underline">View all</Link>
            </div>
            {recentFiles.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-muted-foreground text-sm mb-3">No files uploaded yet.</p>
                <Link to="/contacts"><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5 mr-1" /> Import a file</Button></Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentFiles.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 text-sm border-b border-border last:border-0 pb-3 last:pb-0">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{f.file_name}</div>
                      <div className="text-xs text-muted-foreground">{f.imported_count} contacts · {new Date(f.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent sends */}
          <div className="rounded-xl border border-border bg-card shadow-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold flex items-center gap-2"><Inbox className="h-4 w-4" /> Recent Sends</h2>
            </div>
            {recentSends.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-6">No emails sent yet. Build a sequence to start.</p>
            ) : (
              <div className="space-y-3">
                {recentSends.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 text-sm border-b border-border last:border-0 pb-3 last:pb-0">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{s.subject || "(no subject)"}</div>
                      <div className="text-xs text-muted-foreground truncate">to {s.recipient_email}</div>
                    </div>
                    <span className={`text-xs font-medium ${statusColor(s.status)}`}>{s.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
