import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Fish, ArrowLeft, Clock, CheckCircle2, XCircle, Loader2, Users, FileText, StopCircle } from "lucide-react";
import { toast } from "sonner";

type Simulation = {
  id: string;
  title: string;
  question: string | null;
  status: string;
  agent_count: number;
  agents_processed: number;
  context_summary: string | null;
  created_at: string;
};

type Report = {
  id: string;
  summary: string | null;
  full_report: string | null;
  insights: any;
};

const statusConfig: Record<string, { label: string; icon: any; color: string }> = {
  draft: { label: "Draft", icon: Clock, color: "text-muted-foreground" },
  processing_materials: { label: "Processing Materials", icon: Loader2, color: "text-primary" },
  generating_agents: { label: "Generating Agents", icon: Users, color: "text-primary" },
  running: { label: "Running Simulation", icon: Loader2, color: "text-primary" },
  completed: { label: "Completed", icon: CheckCircle2, color: "text-accent" },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive" },
};

const SimulationDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!id) return;
    setCancelling(true);
    const { error } = await supabase
      .from("simulations")
      .update({ status: "failed" as any })
      .eq("id", id);
    setCancelling(false);
    if (error) {
      toast.error("Failed to cancel simulation");
    } else {
      toast.success("Simulation cancelled");
      setSimulation(prev => prev ? { ...prev, status: "failed" } : null);
    }
  };

  useEffect(() => {
    if (!id) return;

    const fetchData = async () => {
      const { data: sim } = await supabase.from("simulations").select("*").eq("id", id).single();
      if (sim) setSimulation(sim as unknown as Simulation);

      const { data: rep } = await supabase.from("reports").select("*").eq("simulation_id", id).single();
      if (rep) setReport(rep as unknown as Report);

      setLoading(false);
    };

    fetchData();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`simulation-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "simulations", filter: `id=eq.${id}` }, (payload) => {
        setSimulation(payload.new as unknown as Simulation);
        // Refetch report if completed
        if ((payload.new as any).status === "completed") {
          supabase.from("reports").select("*").eq("simulation_id", id).single().then(({ data }) => {
            if (data) setReport(data as unknown as Report);
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!simulation) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Simulation not found.</p>
        <Link to="/dashboard"><Button variant="outline">Back to Dashboard</Button></Link>
      </div>
    );
  }

  const status = statusConfig[simulation.status] || statusConfig.draft;
  const StatusIcon = status.icon;
  const progress = simulation.agent_count > 0 ? Math.round((simulation.agents_processed / simulation.agent_count) * 100) : 0;
  const isRunning = ["processing_materials", "generating_agents", "running"].includes(simulation.status);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <Fish className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>MiroFish</span>
          </Link>
          <Link to="/dashboard">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1.5" /> Dashboard</Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{simulation.title}</h1>
          <div className={`flex items-center gap-2 mt-2 ${status.color}`}>
            <StatusIcon className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
            <span className="text-sm font-medium">{status.label}</span>
          </div>
        </div>

        {/* Progress */}
        {isRunning && (
          <div className="rounded-xl border border-border bg-card p-5 mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Agents processed</span>
              <span className="font-medium">{simulation.agents_processed.toLocaleString()} / {simulation.agent_count.toLocaleString()}</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-muted-foreground">The simulation is running. This page updates automatically.</p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={cancelling}>
                    <StopCircle className="h-4 w-4 mr-1.5" />
                    {cancelling ? "Cancelling..." : "Cancel Run"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this simulation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will stop the simulation. Any agents already processed will be lost. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Running</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Cancel Simulation
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {/* Question */}
        {simulation.question && (
          <div className="rounded-xl border border-border bg-card p-5 mb-6">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <FileText className="h-4 w-4" /> Question
            </h3>
            <p className="text-sm text-muted-foreground">{simulation.question}</p>
          </div>
        )}

        {/* Report */}
        {simulation.status === "completed" && report && (
          <div className="space-y-6">
            {report.summary && (
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium mb-3">Executive Summary</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{report.summary}</p>
              </div>
            )}
            {report.full_report && (
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium mb-3">Full Report</h3>
                <div className="text-sm text-muted-foreground whitespace-pre-wrap">{report.full_report}</div>
              </div>
            )}
          </div>
        )}

        {/* Draft state */}
        {simulation.status === "draft" && (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">This simulation is queued and will start processing shortly.</p>
          </div>
        )}

        {/* Failed state */}
        {simulation.status === "failed" && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
            <XCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
            <p className="text-destructive text-sm">This simulation failed. Please try creating a new one.</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default SimulationDetail;
