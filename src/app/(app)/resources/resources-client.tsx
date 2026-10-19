"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ResourceModal } from "@/components/modals/ResourceModal";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Trash2, Download, Users } from "lucide-react";
import { downloadCSV } from "@/lib/export-csv";
import { EmptyState } from "@/components/ui/empty-state";
import { clientFetch } from "@/lib/client-fetch";
import { useCustomFieldColumns } from "@/components/ui/custom-field-columns";
import { SortableTh } from "@/components/ui/sortable-th";
import { useSort, sortItems, type Accessor } from "@/hooks/use-sortable-data";

const statusColor: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  BLOCKED: "bg-orange-100 text-orange-700",
  INACTIVE: "bg-muted text-muted-foreground",
};

const typeColor: Record<string, string> = {
  CORE: "bg-primary/10 text-primary",
  PARTNER: "bg-violet-100 text-violet-700",
  HIRING: "bg-amber-100 text-amber-700",
};

interface Props {
  resources: any[];
  milestones: { id: string; code: string; title: string }[];
  projectId: string;
  tags: { id: string; name: string; color: string }[];
}

const resourceAccessors: Record<string, Accessor<any>> = {
  name: r => r.name,
  role: r => r.role,
  type: r => r.type,
  dayRate: r => Number(r.dayRate ?? 0),
  monthly: r => Number(r.dayRate ?? 0) * (r.daysPerMonth ?? 0),
  yearly: r => Number(r.yearlyCost ?? 0),
  status: r => r.status,
};

export function ResourcesClient({ resources: initialResources, milestones, projectId, tags }: Props) {
  const cf = useCustomFieldColumns(projectId, "RESOURCE");
  const [resources, setResources] = useState(initialResources);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<any | null>(null);
  const { sortKey, sortDir, toggleSort } = useSort("smartvie:sort:resources");
  const sortedResources = sortItems(resources, resourceAccessors, sortKey, sortDir);

  async function handleDelete(id: string, name: string) {
    if (!await confirmDialog(`Delete resource "${name}"? This cannot be undone.`)) return;
    const res = await clientFetch(`/api/resources/${id}`, { method: "DELETE" });
    if (res.ok) {
      setResources(prev => prev.filter(r => r.id !== id));
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to delete resource. Please try again.");
    }
  }

  function handleSaved() {
    cf.reload();
    clientFetch("/api/resources").then(r => r.json()).then(({ data }) => {
      setResources(data.map((r: any) => ({
        ...r,
        dayRate: r.dayRate ? Number(r.dayRate) : null,
        yearlyCost: r.yearlyCost ? Number(r.yearlyCost) : null,
      })));
    });
  }

  const totalMonthly = resources.reduce((s, r) => {
    const rate = Number(r.dayRate ?? 0);
    const days = r.daysPerMonth ?? 0;
    return s + rate * days;
  }, 0);

  const totalYearly = resources.reduce((s, r) => s + Number(r.yearlyCost ?? 0), 0);
  const activeCount = resources.filter(r => r.status === "ACTIVE").length;

  return (
    <>
      <Topbar title="Resources" subtitle={`${resources.length} team members & contractors`} />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCSV(
            resources.map(r => ({
              name: r.name,
              role: r.role,
              type: r.type,
              status: r.status,
              department: r.department ?? "",
              tag_focus: (r.derivedTags ?? []).join(", ") || "",
              availability: r.availability ?? "",
              day_rate: r.dayRate ?? "",
              days_per_month: r.daysPerMonth ?? "",
              monthly_cost: r.dayRate && r.daysPerMonth ? Number(r.dayRate) * r.daysPerMonth : "",
              yearly_cost: r.yearlyCost ?? "",
            })),
            "resources.csv",
            [
              { key: "name", label: "Name" },
              { key: "role", label: "Role" },
              { key: "type", label: "Type" },
              { key: "status", label: "Status" },
              { key: "department", label: "Department" },
              { key: "tag_focus", label: "Tag Focus" },
              { key: "availability", label: "Availability" },
              { key: "day_rate", label: "Day Rate (GBP)" },
              { key: "days_per_month", label: "Days/Month" },
              { key: "monthly_cost", label: "Monthly Cost (GBP)" },
              { key: "yearly_cost", label: "Yearly Cost (GBP)" },
            ]
          )}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button onClick={() => { setEditingResource(null); setModalOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Resource
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Resources", value: String(resources.length), color: "text-foreground", isCurrency: false },
            { label: "Active", value: String(activeCount), color: "text-emerald-600", isCurrency: false },
            { label: "Monthly Cost", value: formatCurrency(totalMonthly), color: "text-primary", isCurrency: true },
            { label: "Yearly Cost", value: formatCurrency(totalYearly), color: "text-violet-600", isCurrency: true },
          ].map(({ label, value, color }) => (
            <Card key={label}>
              <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent><p className={`text-2xl font-bold ${color}`}>{value}</p></CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <SortableTh label="Name" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={toggleSort} className="px-5" />
                  <SortableTh label="Role" sortKey="role" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <SortableTh label="Type" sortKey="type" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Tag Focus</th>
                  <SortableTh label="Day Rate" sortKey="dayRate" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Monthly" sortKey="monthly" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right" />
                  <SortableTh label="Yearly" sortKey="yearly" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right" />
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Milestones</th>
                  <SortableTh label="Status" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  {cf.columns.map(c => <th key={c.id} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{c.name}</th>)}
                  <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resources.length === 0 ? (
                  <tr>
                    <td colSpan={10 + cf.columns.length}>
                      <EmptyState
                        icon={Users}
                        title="No resources yet"
                        description="Add your first team member or contractor to start tracking costs."
                      />
                    </td>
                  </tr>
                ) : (
                  sortedResources.map(r => {
                    const dayRate = Number(r.dayRate ?? 0);
                    const daysPerMonth = r.daysPerMonth ?? 0;
                    const monthlyCost = dayRate * daysPerMonth;
                    return (
                      <tr key={r.id} className="hover:bg-muted/20">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold shrink-0">
                              {r.name.charAt(0)}
                            </div>
                            <span className="font-medium">{r.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{r.role}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeColor[r.type] ?? "bg-muted text-foreground"}`}>
                            {r.type}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground text-xs">
                          {r.derivedTags?.length > 0
                            ? r.derivedTags.map((tag: string) => (
                                <span key={tag} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/5 text-primary mr-1 mb-0.5">
                                  {tag}
                                </span>
                              ))
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-right">{dayRate > 0 ? formatCurrency(dayRate) : "—"}</td>
                        <td className="px-3 py-3 text-right font-medium">{monthlyCost > 0 ? formatCurrency(monthlyCost) : "—"}</td>
                        <td className="px-3 py-3 text-right">{r.yearlyCost ? formatCurrency(Number(r.yearlyCost)) : "—"}</td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1">
                            {r.resourceMilestones?.map((rm: any) => (
                              <span key={rm.milestoneId} className="text-xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">
                                {rm.milestone?.code}
                              </span>
                            ))}
                            {(!r.resourceMilestones || r.resourceMilestones.length === 0) && <span className="text-muted-foreground">—</span>}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[r.status] ?? "bg-muted text-foreground"}`}>
                            {r.status}
                          </span>
                        </td>
                        {cf.columns.map(c => <td key={c.id} className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">{cf.cell(r.id, c)}</td>)}
                        <td className="px-5 py-3 text-right">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => { setEditingResource(r); setModalOpen(true); }} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDelete(r.id, r.name)} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>

      <ResourceModal open={modalOpen} onOpenChange={setModalOpen} resource={editingResource} milestones={milestones} projectId={projectId} tags={tags} onSaved={handleSaved} />
    </>
  );
}
