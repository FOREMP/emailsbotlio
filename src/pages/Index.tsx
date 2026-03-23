import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { Zap, Brain, Users, BarChart3, Shield, Cpu } from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "AI-Powered Agents",
    description: "Generate intelligent agents from your seed materials — each with unique personas, memories, and behaviors.",
  },
  {
    icon: Users,
    title: "Multi-Agent Simulation",
    description: "Watch agents interact over multiple rounds, debating and evolving their positions to reveal hidden patterns.",
  },
  {
    icon: BarChart3,
    title: "Prediction Reports",
    description: "Get detailed AI-generated prediction reports with confidence scores and supporting evidence.",
  },
  {
    icon: Zap,
    title: "Real-Time Processing",
    description: "Upload documents and get simulations running in minutes, not hours. Watch progress live.",
  },
  {
    icon: Shield,
    title: "Enterprise Ready",
    description: "SOC2-compliant infrastructure with encrypted storage and role-based access controls.",
  },
  {
    icon: Cpu,
    title: "Chat With Agents",
    description: "Interrogate individual agents or the report agent to dig deeper into any prediction.",
  },
];

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <Header />

      {/* Hero */}
      <section className="gradient-hero relative overflow-hidden pt-32 pb-24 md:pt-44 md:pb-32">
        <div className="absolute inset-0 opacity-20" style={{
          backgroundImage: "radial-gradient(circle at 20% 50%, hsl(210 100% 50% / 0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, hsl(170 80% 42% / 0.2) 0%, transparent 40%)"
        }} />
        <div className="container mx-auto px-4 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm text-primary-foreground/80 mb-8">
              <Zap className="h-3.5 w-3.5" />
              AI-Powered Prediction Engine
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.1] mb-6">
              Predict the future with{" "}
              <span className="text-gradient">multi-agent AI</span>
            </h1>
            <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
              Upload your research, news, or reports. MiroFish generates AI agents that simulate real-world interactions to produce actionable predictions.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                onClick={() => navigate("/dashboard")}
                className="gradient-primary border-0 text-primary-foreground text-base px-8 h-12 hover:opacity-90 transition-opacity"
              >
                Start Predicting — Free
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/pricing")}
                className="border-white/20 text-white bg-white/5 hover:bg-white/10 text-base px-8 h-12"
              >
                View Pricing
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 md:py-32">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
              How MiroFish Works
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              From raw data to actionable predictions in three steps: upload, simulate, report.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-xl border border-border bg-card p-6 shadow-card hover:shadow-elevated transition-all duration-300"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg gradient-primary mb-4">
                  <f.icon className="h-5 w-5 text-primary-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 gradient-hero">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to see the future?
          </h2>
          <p className="text-white/60 text-lg mb-8 max-w-xl mx-auto">
            Start with 3 free simulations. No credit card required.
          </p>
          <Button
            size="lg"
            onClick={() => navigate("/dashboard")}
            className="gradient-primary border-0 text-primary-foreground text-base px-8 h-12 hover:opacity-90"
          >
            Get Started Free
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">© 2026 MiroFish. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms</a>
            <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
