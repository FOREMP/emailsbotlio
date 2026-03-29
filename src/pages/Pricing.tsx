import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { Check } from "lucide-react";

const plans = [
  {
    name: "Starter",
    price: "€49",
    period: "/mo",
    description: "Everything you need to get started with email & SMS marketing.",
    features: [
      "5,000 emails / month",
      "500 SMS / month",
      "Reviews widget",
      "1 sending domain",
      "Contact management",
      "Email support",
    ],
    cta: "Get Started",
    popular: false,
  },
  {
    name: "Growth",
    price: "€149",
    period: "/mo",
    description: "For growing stores that need more reach and deeper insights.",
    features: [
      "25,000 emails / month",
      "2,500 SMS / month",
      "Reviews + analytics",
      "3 sending domains",
      "AI-powered campaigns",
      "CSV import",
      "Priority email support",
    ],
    cta: "Start Growth Plan",
    popular: true,
  },
  {
    name: "Pro",
    price: "€349",
    period: "/mo",
    description: "For high-volume stores that demand the full suite.",
    features: [
      "100,000 emails / month",
      "10,000 SMS / month",
      "Full review suite",
      "Unlimited domains",
      "AI-powered campaigns",
      "Advanced analytics",
      "Priority support",
      "Custom review widgets",
    ],
    cta: "Start Pro Plan",
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
            Pick the plan that fits your store. Upgrade or downgrade anytime.
          </p>
        </div>
      </section>

      {/* Plans */}
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

      {/* Footer */}
      <footer className="border-t border-border py-12">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">© 2026 MailxSend. All rights reserved.</p>
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
