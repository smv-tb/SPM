"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState, useMemo, useEffect } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { FundingModal } from "@/components/modals/FundingModal";
import { FundingKanbanBoard, type FundingForecast } from "@/components/funding/FundingKanbanBoard";
import type { PipelineRecord } from "@/components/funding/FundingKanbanCard";
import { FundingAnalyticsSection } from "@/components/funding/FundingAnalyticsSection";
import { PanelErrorBoundary } from "@/components/ui/panel-error-boundary";
import type { FundingStage } from "@/lib/funding";
import { formatCurrency } from "@/lib/utils";
import { Plus, Download, Banknote, Search, LayoutGrid, List, ChevronDown, ChevronRight } from "lucide-react";
import { downloadCSV } from "@/lib/export-csv";
import { EmptyState } from "@/components/ui/empty-state";
import { clientFetch } from "@/lib/client-fetch";
import { useCustomFieldColumns } from "@/components/ui/custom-field-columns";
import { FundingSectionTable } from "./FundingSectionTable";
import {
  FUNDING_CSV_COLUMNS, ALL_FUNDING_TYPES, ALL_SECTIONS, VERIFIED_OPTIONS, typeLabel,
  describeFailure, fundingAccessors, fetchAllFundingRecords,
  filterFundingRecords, splitFundingSections, fundingTotals,
} from "./funding-helpers";
import { useSort, sortItems } from "@/hooks/use-sortable-data";

const VIEW_STORAGE_KEY = "smartvie:funding:view";
interface Props {
  initialRecords: any[];
  projectId: string;
  phases?: { id: string; name: string }[];
  canEditProject?: boolean;
}

export function FundingClient({ initialRecords, projectId, phases = [], canEditProject = false }: Props) {
  const cf = useCustomFieldColumns(projectId, "FUNDING_RECORD");
  const [records, setRecords] = useState(initialRecords);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<any | null>(null);
  const [view, setView] = useState<"records" | "pipeline">("records");
  const [forecast, setForecast] = useState<FundingForecast | null>(null);
  const [utilizationMap, setUtilizationMap] = useState<Record<string, { utilization: number | null; isOverBudget: boolean }>>({});
  // Bumped on every successful mutation so the analytics KPIs refetch too.
  const [analyticsToken, setAnalyticsToken] = useState(0);
  const [dataError, setDataError] = useState("");
  // Pipeline view collapses the totals and analytics so the board leads;
  // switching views resets this.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const summaryHidden = view === "pipeline" && !summaryOpen;

  // Filter + sort state
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterSection, setFilterSection] = useState("");
  const [filterVerified, setFilterVerified] = useState("");
  const { sortKey, sortDir, toggleSort } = useSort("smartvie:sort:funding", "date", "desc");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "records" || stored === "pipeline") setView(stored);
    } catch {
      // storage disabled/inaccessible — default view still works
    }
  }, []);

  function changeView(v: "records" | "pipeline") {
    setView(v);
    setSummaryOpen(false);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      // storage disabled/full — view still switches for this session
    }
  }

  async function fetchForecast() {
    try {
      const res = await clientFetch("/api/funding?forecast=true");
      // A silent `return` here hid a persistent production 403 for a long time.
      if (!res.ok) throw new Error(await describeFailure(res));
      setForecast(await res.json());
    } catch (err) {
      console.error("Failed to load funding forecast:", err);
      setDataError(`Pipeline forecast unavailable — ${(err as Error).message}`);
    }
  }

  useEffect(() => {
    if (view === "pipeline") fetchForecast();
  }, [view]);

  async function fetchUtilization() {
    try {
      const res = await clientFetch("/api/funding?utilization=true");
      if (!res.ok) throw new Error(await describeFailure(res));
      const data = await res.json();
      const map: Record<string, { utilization: number | null; isOverBudget: boolean }> = {};
      for (const r of data.LIVE || []) {
        map[r.id] = { utilization: r.utilization, isOverBudget: r.isOverBudget };
      }
      setUtilizationMap(map);
    } catch (err) {
      console.error("Failed to load funding utilization:", err);
      setDataError(`Utilization unavailable — ${(err as Error).message}`);
    }
  }

  useEffect(() => {
    fetchUtilization();
  }, []);

  const filteredRecords = useMemo(
    () => sortItems(
      filterFundingRecords(records, { search, type: filterType, section: filterSection, verified: filterVerified }),
      fundingAccessors, sortKey, sortDir,
    ),
    [records, search, filterType, filterSection, filterVerified, sortKey, sortDir]
  );

  const sections = useMemo(() => splitFundingSections(filteredRecords), [filteredRecords]);

  const totals = useMemo(() => fundingTotals(filteredRecords, sections), [filteredRecords, sections]);

  const hasFilters = search || filterType || filterSection || filterVerified;

  async function handleDelete(id: string, fundId: string) {
    if (!await confirmDialog(`Delete funding record ${fundId}?`)) return;
    const res = await clientFetch(`/api/funding/${id}`, { method: "DELETE" });
    // Deleting funding needs PM or above; a Contributor's 403 used to vanish
    // silently and the record just stayed put with no explanation.
    if (!res.ok) {
      alert(await describeFailure(res));
      return;
    }
    setRecords(prev => prev.filter(r => r.id !== id));
  }

  function openEditor(record: any | null) {
    setEditingRecord(record);
    setModalOpen(true);
  }

  function handleSaved() {
    cf.reload();
    fetchAllFundingRecords()
      .then(all => {
        setRecords(all.map((r: any) => ({ ...r, amount: Number(r.amount) })));
        setDataError("");
      })
      .catch(err => {
        console.error("Failed to refresh funding records:", err);
        setDataError(`Couldn't refresh the record list — ${err.message}`);
      });
    if (view === "pipeline") fetchForecast();
    fetchUtilization();
    setAnalyticsToken(t => t + 1);
  }

  const pipelineBoardRecords: PipelineRecord[] = useMemo(
    () => sections.PIPELINE.map(r => ({
      id: r.id,
      fundId: r.fundId,
      fundName: r.fundName,
      source: r.source,
      amount: r.amount,
      stage: r.stage ?? null,
      probability: r.probability ?? null,
      deadline: r.deadline ?? null,
      nextAction: r.nextAction ?? null,
      nextActionDate: r.nextActionDate ?? null,
    })),
    [sections.PIPELINE]
  );

  function handlePipelineCardClick(pr: PipelineRecord) {
    const full = records.find(r => r.id === pr.id);
    if (full) {
      setEditingRecord(full);
      setModalOpen(true);
    }
  }

  async function handleStageChange(id: string, newStage: FundingStage) {
    const record = records.find(r => r.id === id);
    setRecords(prev => prev.map(r => (r.id === id ? { ...r, stage: newStage } : r)));

    const res = await clientFetch(`/api/funding/${id}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: newStage }),
    });

    if (!res.ok) {
      handleSaved(); // revert the optimistic update from the server's real state
      return;
    }

    if (newStage === "AWARDED" && record && await confirmDialog({ message: `Move "${record.fundName}" to Live funding and mark it verified?`, title: "Mark as awarded?", confirmLabel: "Move to Live funding", destructive: false })) {
      await clientFetch(`/api/funding/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "LIVE", verified: true }),
      });
    }

    handleSaved();
  }

  function renderSection(title: string, recs: any[], total: number, showUtilization = false) {
    return (
      <FundingSectionTable
        title={title}
        records={recs}
        total={total}
        showUtilization={showUtilization}
        utilizationMap={utilizationMap}
        customFields={cf}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={toggleSort}
        onEdit={openEditor}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <>
      <Topbar title="Funding Tracker" subtitle="Founder investment · Live grants · Pipeline" />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex justify-between gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <button
              onClick={() => changeView("records")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${view === "records" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              <List className="w-3.5 h-3.5" /> Records
            </button>
            <button
              onClick={() => changeView("pipeline")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${view === "pipeline" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Pipeline
            </button>
          </div>
          <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCSV(
            records,
            "funding.csv",
            FUNDING_CSV_COLUMNS
          )}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button onClick={() => { setEditingRecord(null); setModalOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Record
          </Button>
          </div>
        </div>

        {view === "pipeline" && (
          <button
            onClick={() => setSummaryOpen(o => !o)}
            aria-expanded={summaryOpen}
            className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {summaryOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {summaryOpen ? "Hide" : "Show"} totals and financial summary
          </button>
        )}

        {!summaryHidden && (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Founder Investment", value: totals.FOUNDER, color: "text-foreground" },
            { label: "Live Funding", value: totals.LIVE, color: "text-emerald-600" },
            { label: "Pipeline", value: totals.PIPELINE, color: "text-primary" },
            { label: "Total Tracked", value: totals.ALL, color: "text-violet-600" },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent><p className={`text-2xl font-bold ${color}`}>{formatCurrency(value)}</p></CardContent>
            </Card>
          ))}
        </div>

        {dataError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {dataError}
          </div>
        )}

        {/* Boundary, not decoration: a throw in here previously unmounted the
            whole page, taking the Records and Pipeline views with it. */}
        <PanelErrorBoundary label="The financial summary">
          <FundingAnalyticsSection projectId={projectId} refreshToken={analyticsToken} canEditProject={canEditProject} />
        </PanelErrorBoundary>
        </>)}

        {/* Filter toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search fund name, source, type…"
              className="pl-9"
            />
          </div>
          <Select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-32">
            <option value="">All Types</option>
            {ALL_FUNDING_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{typeLabel[t] ?? t}</option>)}
          </Select>
          <Select value={filterSection} onChange={e => setFilterSection(e.target.value)} className="w-36">
            <option value="">All Sections</option>
            {ALL_SECTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
          </Select>
          <Select value={filterVerified} onChange={e => setFilterVerified(e.target.value)} className="w-32">
            {VERIFIED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterType(""); setFilterSection(""); setFilterVerified(""); }}>
              Clear
            </Button>
          )}
        </div>

        {view === "pipeline" ? (
          sections.PIPELINE.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={Banknote}
                  title="No pipeline records yet"
                  description="Add a funding record with section 'Pipeline' to start tracking it here."
                />
              </CardContent>
            </Card>
          ) : (
            <FundingKanbanBoard
              records={pipelineBoardRecords}
              forecast={forecast}
              onCardClick={handlePipelineCardClick}
              onStageChange={handleStageChange}
            />
          )
        ) : (
          <>
            {filteredRecords.length === 0 && records.length > 0 && (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={Banknote}
                    title="No records match your filters"
                    description="Try adjusting your search or filters."
                  />
                </CardContent>
              </Card>
            )}

            {renderSection("Section 0 — Founder Investment", sections.FOUNDER, totals.FOUNDER)}
            {renderSection("Section 1 — Live & Pipeline Funding", sections.LIVE, totals.LIVE, true)}
            {renderSection("Section 2 — Pipeline", sections.PIPELINE, totals.PIPELINE)}
            {renderSection("Withdrawn — not tracked", sections.WITHDRAWN, 0)}
          </>
        )}

        {records.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState
                icon={Banknote}
                title="No funding records yet"
                description="Add your first funding record to start tracking finances."
              />
            </CardContent>
          </Card>
        )}
      </main>

      <FundingModal open={modalOpen} onOpenChange={setModalOpen} record={editingRecord} projectId={projectId} phases={phases} onSaved={handleSaved} />
    </>
  );
}
