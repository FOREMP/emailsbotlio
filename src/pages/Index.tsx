import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { Star, Brain, BarChart3, MessageSquareText, Mail, Zap } from "lucide-react";

const features = [
  {
    icon: Star,
    title: "Review Aggregation",
    description: "Pull reviews from Trustpilot, Google, and more into one unified dashboard. Never miss a review again.",
  },
  {
    icon: Brain,
    title: "AI Sentiment Analysis",
    description: "Automatically score sentiment, extract themes like 'shipping speed' or 'product quality', and spot trends.",
  },
  {
    icon: MessageSquareText,
    title: "AI-Generated Responses",
    description: "Get professional, on-brand response drafts for every review. Edit and post directly to Trustpilot.",
  },
  {
    icon: BarChart3,
    title: "Insight Reports",
    description: "Weekly AI digests and monthly PDF reports with sentiment trends, theme breakdowns, and action items.",
  },
  {
    icon: Mail,
    title: "Automated Review Collection",
    description: "Email past customers to request reviews. Smart scheduling and follow-ups to maximize response rates.",
  },
  {
    icon: Zap,
    title: "Real-Time Alerts",
    description: "Get notified instantly when negative reviews come in or sentiment drops. Act fast, protect your reputation.",
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
              <Brain className="h-3.5 w-3.5" />
              AI-Powered Review Intelligence
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.1] mb-6">
              Turn reviews into{" "}
              <span className="text-gradient">growth insights</span>
            </h1>
            <p className="text-lg md:text-xl text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
              Aggregate reviews from every platform, analyze sentiment with AI, generate smart responses, and collect more positive reviews — all from one dashboard.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                onClick={() => navigate("/dashboard")}
                className="gradient-primary border-0 text-primary-foreground text-base px-8 h-12 hover:opacity-90 transition-opacity"
              >
                Get Started Free
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
              Everything You Need to Master Your Reviews
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              From aggregation and AI analysis to automated collection and smart responses.
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
            Ready to understand your customers better?
          </h2>
          <p className="text-white/60 text-lg mb-8 max-w-xl mx-auto">
            Start analyzing your reviews today. No credit card required.
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
          <p className="text-sm text-muted-foreground">© 2026 ReviewBrain. All rights reserved.</p>
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