import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Fish, ArrowLeft, ArrowRight, Upload, X, FileText, Image, Type, Loader2, Rocket } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SeedMaterial = {
  id: string;
  type: "pdf" | "image" | "text";
  name: string;
  content?: string;
  file?: File;
};

const STEPS = ["Upload Materials", "Configure", "Ask Your Question"];

const SimulationNew = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [materials, setMaterials] = useState<SeedMaterial[]>([]);
  const [textInput, setTextInput] = useState("");
  const [agentCount, setAgentCount] = useState(2000);
  const [question, setQuestion] = useState("");
  const [launching, setLaunching] = useState(false);

  const addTextMaterial = () => {
    if (!textInput.trim()) return;
    setMaterials((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type: "text", name: `Text note ${prev.filter((m) => m.type === "text").length + 1}`, content: textInput },
    ]);
    setTextInput("");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const type = file.type.startsWith("image/") ? "image" : "pdf";
      setMaterials((prev) => [
        ...prev,
        { id: crypto.randomUUID(), type: type as "pdf" | "image", name: file.name, file },
      ]);
    });
    e.target.value = "";
  };

  const removeMaterial = (id: string) => {
    setMaterials((prev) => prev.filter((m) => m.id !== id));
  };

  const handleLaunch = async () => {
    if (!user || !title.trim() || !question.trim()) return;
    setLaunching(true);

    try {
      // Create simulation record
      const { data: sim, error: simError } = await supabase
        .from("simulations")
        .insert({ user_id: user.id, title: title.trim(), question: question.trim(), agent_count: agentCount, status: "draft" as const })
        .select()
        .single();

      if (simError || !sim) throw simError;

      // Upload files and create seed_materials records
      for (const mat of materials) {
        if (mat.type === "text") {
          await supabase.from("seed_materials").insert({
            simulation_id: sim.id,
            user_id: user.id,
            type: "text" as const,
            content: mat.content,
            file_name: mat.name,
          });
        } else if (mat.file) {
          const filePath = `${user.id}/${sim.id}/${mat.id}-${mat.name}`;
          const { error: uploadErr } = await supabase.storage.from("seed-materials").upload(filePath, mat.file);
          if (uploadErr) {
            console.error("Upload error:", uploadErr);
            continue;
          }
          await supabase.from("seed_materials").insert({
            simulation_id: sim.id,
            user_id: user.id,
            type: mat.type as "pdf" | "image",
            file_path: filePath,
            file_name: mat.name,
          });
        }
      }

      toast.success("Simulation created! It will start processing soon.");
      navigate(`/simulation/${sim.id}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to create simulation");
    } finally {
      setLaunching(false);
    }
  };

  const canProceed = () => {
    if (step === 0) return materials.length > 0 && title.trim().length > 0;
    if (step === 1) return agentCount >= 10 && agentCount <= 10000;
    if (step === 2) return question.trim().length > 10;
    return false;
  };

  const materialIcon = (type: string) => {
    if (type === "pdf") return <FileText className="h-4 w-4 text-destructive" />;
    if (type === "image") return <Image className="h-4 w-4 text-primary" />;
    return <Type className="h-4 w-4 text-accent" />;
  };

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
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-semibold shrink-0 transition-colors ${
                i <= step ? "gradient-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}>
                {i + 1}
              </div>
              <span className={`text-sm hidden sm:block truncate ${i <= step ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        {/* Step 0: Upload */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1">Name & Upload Materials</h2>
              <p className="text-sm text-muted-foreground">Give your simulation a title and upload seed materials (PDFs, images) or add text notes.</p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Simulation Title</label>
              <Input placeholder="e.g. Premium Sneaker Launch Analysis" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            {/* File upload zone */}
            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-8 cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Drop PDFs or images here, or click to browse</span>
              <input type="file" className="hidden" multiple accept=".pdf,image/*" onChange={handleFileUpload} />
            </label>

            {/* Text input */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Or add text information</label>
              <div className="flex gap-2">
                <Textarea placeholder="Paste product info, descriptions, pricing details..." value={textInput} onChange={(e) => setTextInput(e.target.value)} className="min-h-[80px]" />
                <Button variant="outline" size="sm" className="shrink-0 self-end" onClick={addTextMaterial} disabled={!textInput.trim()}>
                  Add
                </Button>
              </div>
            </div>

            {/* Materials list */}
            {materials.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border text-sm font-medium">
                  {materials.length} material{materials.length > 1 ? "s" : ""} added
                </div>
                <div className="divide-y divide-border">
                  {materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                      {materialIcon(m.type)}
                      <span className="text-sm flex-1 truncate">{m.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">{m.type}</span>
                      <button onClick={() => removeMaterial(m.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 1: Configure */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1">Configure Simulation</h2>
              <p className="text-sm text-muted-foreground">Set how many synthetic personas should evaluate your materials.</p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Number of Agents</label>
              <Input type="number" min={10} max={10000} step={10} value={agentCount} onChange={(e) => setAgentCount(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground mt-1.5">
                Each agent is a unique AI persona with distinct demographics, personality traits, and goals. More agents = more comprehensive analysis. (10–10,000)
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="text-sm font-medium mb-2">Estimated Cost</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold">1</span>
                <span className="text-muted-foreground text-sm">credit</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Each simulation costs 1 credit regardless of agent count.</p>
            </div>
          </div>
        )}

        {/* Step 2: Question */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1">Ask Your Question</h2>
              <p className="text-sm text-muted-foreground">What do you want {agentCount.toLocaleString()} synthetic personas to evaluate about your materials?</p>
            </div>

            <Textarea
              placeholder="e.g. How would consumers in the 25-40 age group react to a premium pricing strategy ($149) for this sneaker? Would they buy it, recommend it, or look for alternatives?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-[140px]"
            />
            <p className="text-xs text-muted-foreground">Be specific about what you want to learn. The more context in your question, the better the simulation results.</p>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <h3 className="text-sm font-medium">Simulation Summary</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Title</span>
                <span className="font-medium truncate">{title}</span>
                <span className="text-muted-foreground">Materials</span>
                <span className="font-medium">{materials.length} items</span>
                <span className="text-muted-foreground">Agents</span>
                <span className="font-medium">{agentCount.toLocaleString()}</span>
                <span className="text-muted-foreground">Cost</span>
                <span className="font-medium">1 credit</span>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed()} className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
              Next <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button onClick={handleLaunch} disabled={!canProceed() || launching} className="gradient-primary border-0 text-primary-foreground hover:opacity-90">
              {launching ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Rocket className="h-4 w-4 mr-1.5" />}
              Launch Simulation
            </Button>
          )}
        </div>
      </main>
    </div>
  );
};

export default SimulationNew;
