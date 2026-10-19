"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

// Maps the Tailwind badge classes used elsewhere for stage colors to hex,
// since recharts needs actual color values rather than CSS classes.
const STAGE_HEX: Record<string, string> = {
  "bg-muted text-foreground": "#9ca3af",
  "bg-primary/10 text-primary": "#3b82f6",
  "bg-indigo-100 text-indigo-700": "#6366f1",
  "bg-amber-100 text-amber-700": "#f59e0b",
  "bg-emerald-100 text-emerald-700": "#10b981",
  "bg-red-100 text-red-700": "#ef4444",
  "bg-muted text-muted-foreground": "#94a3b8",
};

interface StageRow {
  stage: string;
  label: string;
  color: string;
  count: number;
  totalAmount: number;
}

interface Props {
  pipelineByStage: StageRow[];
  securedTotal: number;
  weightedForecastTotal: number;
}

export function ReportsCharts({ pipelineByStage, securedTotal, weightedForecastTotal }: Props) {
  const comparisonData = [
    { name: "Secured", value: securedTotal, fill: "#10b981" },
    { name: "Weighted Forecast", value: weightedForecastTotal, fill: "#f59e0b" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Pipeline by Stage</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260} minWidth={0}>
            <BarChart data={pipelineByStage} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
              <Tooltip
                formatter={(v) => formatCurrency(Number(v))}
                labelFormatter={(label, payload) => {
                  const count = payload?.[0]?.payload?.count;
                  return count != null ? `${label} (${count})` : label;
                }}
              />
              <Bar dataKey="totalAmount" radius={[0, 4, 4, 0]}>
                {pipelineByStage.map((row) => (
                  <Cell key={row.stage} fill={STAGE_HEX[row.color] ?? "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Secured vs Weighted Forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260} minWidth={0}>
            <BarChart data={comparisonData} margin={{ top: 5, right: 0, left: -10, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {comparisonData.map((row) => (
                  <Cell key={row.name} fill={row.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
