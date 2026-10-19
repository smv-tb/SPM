"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { clientFetch } from "@/lib/client-fetch";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";

interface MonthlyPoint {
  month: string;
  cashIn: number;
  burn: number;
  cumulativeCashIn: number;
  cumulativeSpend: number;
}

interface OverdueTranche {
  id: string;
  label: string;
  dueDate: string;
  amount: number;
  fundName: string;
  direction: "INCOMING" | "OUTGOING";
}

/** Tranche totals, for reconciling Secured against In Bank. */
export interface TrancheReconciliation {
  incomingScheduled: number;
  incomingReceived: number;
  incomingOutstanding: number;
  outgoingScheduled: number;
  outgoingRepaid: number;
  outgoingOutstanding: number;
  /** Award value not scheduled through any tranche — treated as already banked. */
  unscheduled: number;
  incomingCount: number;
  outgoingCount: number;
}

export interface FundingAnalyticsData {
  /** The real balance from Books → Bank; null without books access or a bank account. */
  bank: { balance: number; asOf: string | null; accounts: number; fromStatement: boolean } | null;
  canSeeBank: boolean;
  securedCash: number;
  bankedCash: number;
  awaitingReceipt: number;
  committedOutflows: number;
  repaidOutflows: number;
  trancheSummary: TrancheReconciliation | null;
  totalSpend: number;
  taskSpend: number;
  livingLabSpend: number;
  historicalSpend: number;
  projectId: string | null;
  remaining: number;
  avgMonthlyBurn: number;
  runwayMonths: number | null;
  weightedForecast: number;
  monthlySeries: MonthlyPoint[];
  burnMethod: string;
  activeMonths: number;
  overdueTranches: OverdueTranche[];
}

interface Props {
  /** Whether to offer editing historical spend (a project edit, PM+). */
  canEditProject?: boolean;
  projectId?: string;
  initialData?: FundingAnalyticsData | null;
  /**
   * Bumped by the parent after any mutation. Without it the KPI row kept
   * showing pre-save figures — a new grant appeared in the section totals
   * while Secured/Remaining/Runway above stayed stale until a page reload.
   */
  refreshToken?: number;
}

/**
 * Fills in anything the payload is missing.
 *
 * This component renders inside the funding page's tree, so a property access
 * on an absent field (`data.overdueTranches.length`) throws during render and
 * takes the whole page down with it — the Records and Pipeline views included.
 * A financial summary failing to load must degrade to "no summary", never to a
 * blank page, so every field the render touches gets a safe default here.
 */
function normalize(raw: Partial<FundingAnalyticsData> | null): FundingAnalyticsData | null {
  if (!raw || typeof raw !== "object") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    bank:
      raw.bank && typeof raw.bank === "object" && typeof raw.bank.balance === "number"
        ? { ...raw.bank, asOf: raw.bank.asOf ?? null }
        : null,
    canSeeBank: raw.canSeeBank === true,
    securedCash: num(raw.securedCash),
    bankedCash: num(raw.bankedCash),
    awaitingReceipt: num(raw.awaitingReceipt),
    committedOutflows: num(raw.committedOutflows),
    repaidOutflows: num(raw.repaidOutflows),
    totalSpend: num(raw.totalSpend),
    taskSpend: num(raw.taskSpend),
    livingLabSpend: num(raw.livingLabSpend),
    historicalSpend: num(raw.historicalSpend),
    projectId: raw.projectId ?? null,
    remaining: num(raw.remaining),
    avgMonthlyBurn: num(raw.avgMonthlyBurn),
    // Genuinely nullable — "no runway figure" is different from "zero months".
    runwayMonths: typeof raw.runwayMonths === "number" ? raw.runwayMonths : null,
    weightedForecast: num(raw.weightedForecast),
    monthlySeries: Array.isArray(raw.monthlySeries) ? raw.monthlySeries : [],
    burnMethod: raw.burnMethod ?? "average",
    activeMonths: num(raw.activeMonths),
    overdueTranches: Array.isArray(raw.overdueTranches) ? raw.overdueTranches : [],
    trancheSummary: raw.trancheSummary ?? null,
  };
}

export function FundingAnalyticsSection({ projectId, initialData, refreshToken = 0, canEditProject = false }: Props) {
  const [data, setData] = useState<FundingAnalyticsData | null>(() => normalize(initialData ?? null));
  const [loadError, setLoadError] = useState("");
  const [editingHistorical, setEditingHistorical] = useState(false);
  const [historicalInput, setHistoricalInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function load() {
    clientFetch("/api/funding/analytics")
      .then(async (r) => {
        if (!r.ok) {
          // Carry the server's own reason through — a bare status code sent us
          // hunting for a client bug when the cause was a 403 from the CSRF
          // origin check in proxy.ts.
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error ? `${body.error} (${r.status})` : `Request failed (${r.status})`);
        }
        // Only replace good data with good data — a failed refresh used to
        // resolve to null and silently blank the whole KPI block.
        setData(normalize(await r.json()));
        setLoadError("");
      })
      .catch((err) => {
        console.error("Failed to load funding analytics:", err);
        setLoadError(`Couldn't load the financial summary — ${err.message}`);
      });
  }

  useEffect(() => {
    if (initialData && refreshToken === 0) return;
    load();
  }, [initialData, refreshToken]);

  if (!data) {
    return loadError ? <p className="text-xs text-red-600">{loadError}</p> : null;
  }

  async function handleSaveHistorical() {
    const id = projectId ?? data?.projectId;
    if (!id) return;
    setSaving(true);
    setSaveError("");
    const res = await clientFetch("/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, historicalSpend: parseFloat(historicalInput) || 0 }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSaveError(body.error || "Failed to save historical spend");
      return;
    }
    setEditingHistorical(false);
    load();
  }

  // "Secured" is money awarded to us; "Funding received" is the part that has
  // landed, worked out from the funding records. "In Bank" is neither: it is
  // the bank's own balance, from Books → Bank, so the two can be compared.
  const bankHint = data.bank
    ? data.bank.fromStatement
      ? `Bank statement${data.bank.accounts > 1 ? `s (${data.bank.accounts} accounts)` : ""}${data.bank.asOf ? `, ${formatDate(data.bank.asOf)}` : ""}`
      : "From the books — import a statement to use the bank's own figure"
    : data.canSeeBank
      ? "Add the bank account in Books → Bank"
      : "Needs Books access";
  const kpis: { label: string; value: string; color: string; hint: string | null; href?: string }[] = [
    {
      label: "In Bank",
      value: data.bank ? formatCurrency(data.bank.balance) : "—",
      color: "text-emerald-700",
      hint: bankHint,
      href: data.canSeeBank ? "/books/bank" : undefined,
    },
    {
      label: "Secured",
      value: formatCurrency(data.securedCash),
      color: "text-emerald-600",
      hint: data.awaitingReceipt > 0 ? `${formatCurrency(data.awaitingReceipt)} awaiting receipt` : null,
    },
    {
      label: "Funding received",
      value: formatCurrency(data.bankedCash),
      color: "text-emerald-600",
      hint: "Awards received, from the funding records",
    },
    { label: "Spent", value: formatCurrency(data.totalSpend), color: "text-red-600", hint: null },
    {
      label: "Remaining",
      value: formatCurrency(data.remaining),
      color: data.remaining < 0 ? "text-red-600" : "text-primary",
      hint: data.committedOutflows > 0 ? `${formatCurrency(data.committedOutflows)} to repay` : null,
    },
    {
      label: "Runway",
      value: data.runwayMonths != null ? `${data.runwayMonths.toFixed(1)} mo` : "—",
      color: "text-violet-600",
      hint: `${formatCurrency(data.avgMonthlyBurn)}/mo avg`,
    },
    {
      label: "Weighted Forecast",
      value: formatCurrency(data.weightedForecast),
      color: "text-amber-600",
      hint: null,
    },
  ];

  return (
    <div className="space-y-4">
      {loadError && <p className="text-xs text-red-600">{loadError}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
        {kpis.map((k) => {
          const card = (
            <Card className={k.href ? "h-full hover:border-primary transition-colors" : "h-full"}>
              <CardHeader>
                <CardTitle>{k.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                {k.hint && <p className="text-xs text-muted-foreground mt-0.5">{k.hint}</p>}
              </CardContent>
            </Card>
          );
          return k.href ? (
            <Link key={k.label} href={k.href} aria-label={`${k.label}: open Books → Bank`}>
              {card}
            </Link>
          ) : (
            <div key={k.label}>{card}</div>
          );
        })}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>Task actuals: <span className="font-semibold text-foreground">{formatCurrency(data.taskSpend)}</span></span>
            <span>Living Labs actuals: <span className="font-semibold text-foreground">{formatCurrency(data.livingLabSpend)}</span></span>
            {data.repaidOutflows > 0 && (
              <span>Repaid: <span className="font-semibold text-foreground">{formatCurrency(data.repaidOutflows)}</span></span>
            )}
            <span>
              Historical (pre-system): <span className="font-semibold text-foreground">{formatCurrency(data.historicalSpend)}</span>
              {canEditProject && !editingHistorical && (
                <button
                  type="button"
                  onClick={() => { setHistoricalInput(String(data.historicalSpend)); setEditingHistorical(true); }}
                  className="ml-2 text-primary font-semibold hover:underline"
                >
                  Edit
                </button>
              )}
            </span>
          </div>
          {editingHistorical && (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={historicalInput}
                onChange={(e) => setHistoricalInput(e.target.value)}
                className="w-40"
              />
              <Button type="button" size="sm" onClick={handleSaveHistorical} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditingHistorical(false)}>
                Cancel
              </Button>
            </div>
          )}
          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        </CardContent>
      </Card>

      {data.trancheSummary && (
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation — Secured to funding received</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-1.5">Secured (awarded &amp; verified)</td>
                  <td className="py-1.5 text-right font-semibold">{formatCurrency(data.securedCash)}</td>
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-1.5 pl-4">
                    Received via tranches
                    {data.trancheSummary.incomingCount > 0 && ` (${data.trancheSummary.incomingCount} scheduled)`}
                  </td>
                  <td className="py-1.5 text-right">{formatCurrency(data.trancheSummary.incomingReceived)}</td>
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-1.5 pl-4">Not scheduled through a tranche — treated as banked</td>
                  <td className="py-1.5 text-right">{formatCurrency(data.trancheSummary.unscheduled)}</td>
                </tr>
                <tr className="text-amber-700">
                  <td className="py-1.5 pl-4">Awaiting receipt (scheduled, not yet in)</td>
                  <td className="py-1.5 text-right font-semibold">
                    −{formatCurrency(data.trancheSummary.incomingOutstanding)}
                  </td>
                </tr>
                <tr className="border-t-2 border-border">
                  <td className="py-1.5 font-semibold">Funding received</td>
                  <td className="py-1.5 text-right font-bold text-emerald-700">{formatCurrency(data.bankedCash)}</td>
                </tr>
                <tr>
                  <td className="py-1.5">Spent to date</td>
                  <td className="py-1.5 text-right font-semibold text-red-600">−{formatCurrency(data.totalSpend)}</td>
                </tr>
                <tr className="border-t-2 border-border">
                  <td className="py-1.5 font-semibold">Remaining</td>
                  <td className={`py-1.5 text-right font-bold ${data.remaining < 0 ? "text-red-600" : "text-primary"}`}>
                    {formatCurrency(data.remaining)}
                  </td>
                </tr>
                {data.trancheSummary.outgoingScheduled > 0 && (
                  <>
                    <tr className="text-muted-foreground">
                      <td className="py-1.5 pt-3">
                        Repayments scheduled ({data.trancheSummary.outgoingCount})
                      </td>
                      <td className="py-1.5 pt-3 text-right">{formatCurrency(data.trancheSummary.outgoingScheduled)}</td>
                    </tr>
                    <tr className="text-muted-foreground">
                      <td className="py-1.5 pl-4">Already repaid (counted in spend)</td>
                      <td className="py-1.5 text-right">{formatCurrency(data.trancheSummary.outgoingRepaid)}</td>
                    </tr>
                    <tr className="text-orange-700">
                      <td className="py-1.5 pl-4">Still to repay (not yet in spend)</td>
                      <td className="py-1.5 text-right font-semibold">
                        {formatCurrency(data.trancheSummary.outgoingOutstanding)}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">
              Funding received is derived from tranche receipts, not typed in: mark a tranche received on
              its funding record, or adjust the record&apos;s amount. It is not the bank balance — that is
              the In Bank tile, taken from the bank statements in Books → Bank.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>
              Cash-in vs Burn — burn averaged over {data.activeMonths} active month{data.activeMonths === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220} minWidth={0}>
              <BarChart data={data.monthlySeries} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Bar dataKey="cashIn" name="Cash In" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="burn" name="Burn" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cumulative Cash vs Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220} minWidth={0}>
              <LineChart data={data.monthlySeries} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Line type="monotone" dataKey="cumulativeCashIn" name="Cumulative Cash" stroke="#0058be" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cumulativeSpend" name="Cumulative Spend" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {data.overdueTranches.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Overdue Tranches</CardTitle>
              <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-bold">
                {data.overdueTranches.length}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {data.overdueTranches.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  <span className={`mr-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${t.direction === "OUTGOING" ? "bg-orange-100 text-orange-700" : "bg-primary/10 text-primary"}`}>
                    {t.direction === "OUTGOING" ? "Repay" : "Receive"}
                  </span>
                  {t.fundName} — {t.label}
                </span>
                <span className="font-semibold text-red-600">
                  {formatCurrency(t.amount)} · due {new Date(t.dueDate).toLocaleDateString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
