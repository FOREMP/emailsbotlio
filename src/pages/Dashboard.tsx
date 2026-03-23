import { Button } from "@/components/ui/button";
import { Fish, Plus, Clock, BarChart3, MessageSquare, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

const mockSimulations = [
  { id: "1", title: "US Election Outcome 2028", status: "completed", agents: 12, rounds: 20, date: "Mar 20, 2026" },
  { id: "2", title: "Bitcoin Price Q4 Forecast", status: "running", agents: 8, rounds: 14, date: "Mar 22, 2026" },
  { id: "3", title: "EU AI Regulation Impact", status: "draft", agents: 0, rounds: 0, date: "Mar 23, 2026" },
];

const statusColors: Record<string, string> = {
  completed: "bg-accent/20 text-accent",
  running: "bg-primary/20 text-primary",
  draft: "bg-muted text-muted-foreground",
};

const Dashboard = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Dashboard header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <Fish className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>MiroFish</span>
          </Link>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">3</span> credits remaining
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <LogOut className="h-4 w-4 mr-1.5" />
              Log out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Welcome + new sim */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Manage your simulations and view predictions.</p>
          </div>
          <Button className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4 mr-1.5" />
            New Simulation
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Simulations", value: "3", icon: BarChart3 },
            { label: "Running", value: "1", icon: Clock },
            { label: "Agents Created", value: "20", icon: MessageSquare },
            { label: "Credits Used", value: "7", icon: BarChart3 },
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

        {/* Simulations list */}
        <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold">Your Simulations</h2>
          </div>
          <div className="divide-y divide-border">
            {mockSimulations.map((sim) => (
              <div key={sim.id} className="flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{sim.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {sim.agents} agents · {sim.rounds} rounds · {sim.date}
                  </div>
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full capitalize ${statusColors[sim.status]}`}>
                  {sim.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
