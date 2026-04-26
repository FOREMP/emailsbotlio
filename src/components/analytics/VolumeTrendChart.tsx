import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Props {
  data: { date: string; sent: number; opened: number; replied: number }[];
}

export const VolumeTrendChart = ({ data }: Props) => (
  <div className="rounded-xl border border-border bg-card p-6 shadow-card">
    <h2 className="font-semibold mb-1">Daily Volume</h2>
    <p className="text-xs text-muted-foreground mb-4">Sent, opened and replied per day</p>
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="gSent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gOpened" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(d) => d.slice(5)} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
          />
          <Area type="monotone" dataKey="sent" stroke="hsl(var(--primary))" fill="url(#gSent)" strokeWidth={2} />
          <Area type="monotone" dataKey="opened" stroke="hsl(var(--accent))" fill="url(#gOpened)" strokeWidth={2} />
          <Area type="monotone" dataKey="replied" stroke="hsl(var(--destructive))" fill="transparent" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
);
