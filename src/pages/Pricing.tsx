import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { Check } from "lucide-react";

const plans = [
  {
    name: "Starter",
    price: "$49",
    period: "/mo",
    description: "Aggregate reviews and get AI-powered insights to understand your customers.",
    features: [
      "3 review sources",
      "Review aggregation dashboard",
      "AI sentiment & theme analysis",
      "500 AI analyses / month",
      "Weekly email digest",
      "Email support",
    ],
    cta: "Get Started",
    popular: false,
  },
  {
    name: "Growth",
    price: "$129",
    period: "/mo",
    description: "Respond smarter and collect more reviews with AI-powered tools.",
    features: [
      "10 review sources",
      "AI-generated review responses",
      "Post replies to Trustpilot",
      "5,000 AI analyses / month",
      "Monthly PDF reports",
      "Trend alerts",
      "1,000 review request emails / mo",
    ],
    cta: "Start Growth Plan",
    popular: true,
  },
  {
    name: "Business",
    price: "$249",
    period: "/mo",
    description: "Full suite for teams that take online reputation seriously.",
    features: [
      "Unlimited review sources",
      "Unlimited AI analysis",
      "Competitor benchmarking",
      "10,000 review request emails / mo",
      "API access",
      "White-label reports",
      "Priority support",
    ],
    cta: "Start Business Plan",
    popular: false,
  },
];

const Pricing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <Header />

      <section className="pt-32 pb-16 md:pt-40">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Simple, transparent pricing
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Pick the plan that fits your business. Upgrade or downgrade anytime.
          </p>
        </div>
      </section>

      <section className="pb-24">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-xl border p-6 flex flex-col ${
                  plan.popular
                    ? "border-primary shadow-elevated bg-card"
                    : "border-border shadow-card bg-card"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="gradient-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground text-sm">{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className={
                    plan.popular
                      ? "w-full gradient-primary border-0 text-primary-foreground hover:opacity-90"
                      : "w-full"
                  }
                  variant={plan.popular ? "default" : "outline"}
                  onClick={() => navigate("/auth")}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">© 2026 ReviewBrain. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Pricing;