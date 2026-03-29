import { Button } from "@/components/ui/button";
import { Send, Plus, Mail, MessageSquare, Users, Star, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

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
            <p className="text-muted-foreground text-sm mt-1">Manage your campaigns, contacts, and reviews.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Contacts", value: "0", icon: Users },
            { label: "Email Campaigns", value: "0", icon: Mail },
            { label: "SMS Campaigns", value: "0", icon: MessageSquare },
            { label: "Reviews", value: "0", icon: Star },
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
            <h2 className="font-semibold mb-2">Contacts</h2>
            <p className="text-muted-foreground text-sm mb-4">Import your customer list to start sending campaigns.</p>
            <Button onClick={() => navigate("/contacts")} className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
              <Users className="h-4 w-4 mr-1.5" /> Manage Contacts
            </Button>
          </div>
          <div className="rounded-xl border border-border bg-card shadow-card p-6">
            <h2 className="font-semibold mb-2">Campaigns</h2>
            <p className="text-muted-foreground text-sm mb-4">Create and send email or SMS campaigns to your contacts.</p>
            <Button variant="outline" disabled>
              <Plus className="h-4 w-4 mr-1.5" /> New Campaign (coming soon)
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
