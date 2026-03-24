import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Fish, Plus, Clock, BarChart3, MessageSquare, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type Simulation = {
  id: string;
  title: string;
  status: string;
  agent_count: number;
  agents_processed: number;
  created_at: string;
};

const statusColors: Record<string, string> = {
  completed: "bg-accent/20 text-accent",
  running: "bg-primary/20 text-primary",
  generating_agents: "bg-primary/20 text-primary",
  processing_materials: "bg-primary/20 text-primary",
  draft: "bg-muted text-muted-foreground",
  failed: "bg-destructive/20 text-destructive",
};

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [simulations, setSimulations] = useState<Simulation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from("simulations")
        .select("id, title, status, agent_count, agents_processed, created_at")
        .order("created_at", { ascending: false });
      if (data) setSimulations(data as unknown as Simulation[]);
      setLoading(false);
    };
    fetch();
  }, []);

  const runningCount = simulations.filter((s) => ["running", "generating_agents", "processing_materials"].includes(s.status)).length;
  const totalAgents = simulations.reduce((sum, s) => sum + s.agents_processed, 0);

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
            <p className="text-muted-foreground text-sm mt-1">Manage your simulations and view predictions.</p>
          </div>
          <Link to="/simulation/new">
            <Button className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4 mr-1.5" />
              New Simulation
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Simulations", value: String(simulations.length), icon: BarChart3 },
            { label: "Running", value: String(runningCount), icon: Clock },
            { label: "Agents Created", value: totalAgents.toLocaleString(), icon: MessageSquare },
            { label: "Credits Used", value: String(simulations.length), icon: BarChart3 },
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
            <h2 className="font-semibold">Your Simulations</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : simulations.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground text-sm mb-4">No simulations yet. Create your first one!</p>
              <Link to="/simulation/new">
                <Button variant="outline" size="sm"><Plus className="h-4 w-4 mr-1.5" /> New Simulation</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {simulations.map((sim) => (
                <div
                  key={sim.id}
                  onClick={() => navigate(`/simulation/${sim.id}`)}
                  className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{sim.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {sim.agent_count.toLocaleString()} agents · {new Date(sim.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${statusColors[sim.status] || "bg-muted text-muted-foreground"}`}>
                    {sim.status.replace(/_/g, " ")}
                  </span>
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
