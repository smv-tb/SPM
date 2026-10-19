"use client";

import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const STATUS_COLORS: Record<string, string> = {
  DONE: "#10b981",
  IN_PROGRESS: "#0ea5e9",
  BACKLOG: "#94a3b8",
  BLOCKED: "#f97316",
  ON_HOLD: "#eab308",
  OVERDUE: "#ef4444",
};

const STATUS_LABELS: Record<string, string> = {
  DONE: "Done",
  IN_PROGRESS: "In Progress",
  BACKLOG: "Backlog",
  BLOCKED: "Blocked",
  ON_HOLD: "On Hold",
  OVERDUE: "Overdue",
};

interface DashboardChartsProps {
  statusData: { name: string; value: number }[];
  milestoneData: { code: string; estBudget: number; actualSpend: number; percentComplete: number }[];
}

export function DashboardCharts({ statusData, milestoneData }: DashboardChartsProps) {
  const total = statusData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Task Status Donut — spans 2 cols */}
      <div className="lg:col-span-2 bg-surface-container-low rounded-xl p-8">
        <h4 className="text-lg font-bold mb-6 tracking-tight">Task Status Breakdown</h4>
        <div className="flex items-center justify-around gap-8">
          <div className="relative w-48 h-48 shrink-0">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  dataKey="value"
                  nameKey="name"
                  paddingAngle={3}
                  stroke="none"
                >
                  {statusData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-2xl font-black">{total}</span>
              <span className="text-xs uppercase font-bold text-muted-foreground tracking-widest">Tasks</span>
            </div>
          </div>
          {/* Legend */}
          <div className="space-y-3 flex-1 max-w-xs">
            {statusData.map((d) => (
              <div key={d.name} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[d.name] ?? "#94a3b8" }} />
                  <span className="text-sm font-semibold">{STATUS_LABELS[d.name] ?? d.name}</span>
                </div>
                <span className="text-sm font-bold">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Budget by Milestone Bar Chart */}
      <div className="bg-surface-container-low rounded-xl p-8">
        <h4 className="text-lg font-bold mb-6 tracking-tight">Budget by Milestone</h4>
        <ResponsiveContainer width="100%" height={220} minWidth={0}>
          <BarChart data={milestoneData} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
            <XAxis dataKey="code" tick={{ fontSize: 10, fontWeight: 700, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(value) => `£${Number(value).toLocaleString()}`}
              labelFormatter={(label, payload) => payload && payload[0] ? `${payload[0].payload.code} — ${payload[0].payload.dueDate}` : label}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
            />
            <Bar dataKey="estBudget" name="Estimated" fill="#0058be" radius={[6, 6, 0, 0]} />
            <Bar dataKey="actualSpend" name="Spent" fill="#2170e4" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
