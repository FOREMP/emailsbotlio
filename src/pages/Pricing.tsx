import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { Check, Zap } from "lucide-react";

const plans = [
  {
    name: "Starter",
    price: "$19",
    period: "/month",
    description: "For individuals exploring AI predictions",
    features: [
      "10 simulations / month",
      "Up to 5 agents per simulation",
      "10 rounds per simulation",
      "Basic prediction reports",
      "Email support",
    ],
    cta: "Get Started",
    popular: false,
  },
  {
    name: "Pro",
    price: "$79",
    period: "/month",
    description: "For professionals who need deeper insights",
    features: [
      "50 simulations / month",
      "Up to 20 agents per simulation",
      "40 rounds per simulation",
      "Advanced prediction reports",
      "Chat with agents",
      "Priority support",
      "Export reports as PDF",
    ],
    cta: "Start Pro Trial",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "$249",
    period: "/month",
    description: "For teams running large-scale simulations",
    features: [
      "Unlimited simulations",
      "Up to 50 agents per simulation",
      "Unlimited rounds",
      "Custom report templates",
      "Team workspaces",
      "API access",
      "Dedicated support",
      "SSO & audit logs",
    ],
    cta: "Contact Sales",
    popular: false,
  },
];

const singleUse = [
  { simulations: 1, price: "$5", perSim: "$5.00" },
  { simulations: 5, price: "$20", perSim: "$4.00" },
  { simulations: 15, price: "$45", perSim: "$3.00" },
  { simulations: 50, price: "$100", perSim: "$2.00" },
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
            Choose a plan or buy simulations à la carte. Start free — no credit card needed.
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="pb-20">
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
                  onClick={() => navigate("/dashboard")}
                >
                  {plan.cta}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Single-use packs */}
      <section className="pb-24">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 text-sm font-medium text-primary mb-3">
                <Zap className="h-4 w-4" />
                Pay As You Go
              </div>
              <h2 className="text-2xl md:text-3xl font-bold mb-2">
                Simulation Packs
              </h2>
              <p className="text-muted-foreground">
                Don't need a subscription? Buy simulation credits individually.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {singleUse.map((pack) => (
                <div
                  key={pack.simulations}
                  className="rounded-xl border border-border bg-card p-5 shadow-card text-center hover:shadow-elevated transition-all"
                >
                  <div className="text-3xl font-bold mb-1">{pack.simulations}</div>
                  <div className="text-sm text-muted-foreground mb-3">
                    {pack.simulations === 1 ? "simulation" : "simulations"}
                  </div>
                  <div className="text-2xl font-bold mb-1">{pack.price}</div>
                  <div className="text-xs text-muted-foreground mb-4">{pack.perSim} per sim</div>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => navigate("/dashboard")}>
                    Buy
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">© 2026 MiroFish. All rights reserved.</p>
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
