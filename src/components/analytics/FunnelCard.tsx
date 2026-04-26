interface Props {
  kpis: { sent: number; delivered: number; opened: number; replied: number };
}

export const FunnelCard = ({ kpis }: Props) => {
  const max = Math.max(kpis.sent, 1);
  const steps = [
    { label: "Sent", value: kpis.sent },
    { label: "Delivered", value: kpis.delivered },
    { label: "Opened", value: kpis.opened },
    { label: "Replied", value: kpis.replied },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card">
      <h2 className="font-semibold mb-1">Conversion Funnel</h2>
      <p className="text-xs text-muted-foreground mb-4">From send to reply</p>
      <div className="space-y-3">
        {steps.map((s, i) => {
          const pct = (s.value / max) * 100;
          const conv = i === 0 ? 100 : kpis.sent ? (s.value / kpis.sent) * 100 : 0;
          return (
            <div key={s.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground">
                  {s.value.toLocaleString()} · {conv.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div className="h-full gradient-primary" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
