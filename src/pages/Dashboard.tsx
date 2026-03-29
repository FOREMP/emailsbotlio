import { Button } from "@/components/ui/button";
import { Fish, Plus, Mail, MessageSquare, Users, Star, LogOut } from "lucide-react";
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
              <Fish className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>MiroFish</span>
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

        <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold">Recent Campaigns</h2>
          </div>
          <div className="p-8 text-center">
            <p className="text-muted-foreground text-sm mb-4">No campaigns yet. Create your first one!</p>
            <Button variant="outline" size="sm" disabled>
              <Plus className="h-4 w-4 mr-1.5" /> New Campaign (coming soon)
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
