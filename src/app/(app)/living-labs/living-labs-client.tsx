"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState } from "react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { LivingLabCostModal } from "@/components/modals/LivingLabCostModal";
import { LivingLabFieldsModal } from "@/components/modals/LivingLabFieldsModal";
import { useCustomFieldColumns } from "@/components/ui/custom-field-columns";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { clientFetch } from "@/lib/client-fetch";
import { SortableTh } from "@/components/ui/sortable-th";
import { useSort, sortItems, type Accessor } from "@/hooks/use-sortable-data";

interface Props {
  initialLabs: any[];
  users: { id: string; name: string }[];
  projectId: string;
}

const costAccessors: Record<string, Accessor<any>> = {
  category: c => c.categoryName,
  owner: c => c.owner?.name,
  estBudget: c => Number(c.estBudget),
  actualSpend: c => Number(c.actualSpend),
};

export function LivingLabsClient({ initialLabs, users, projectId }: Props) {
  const cf = useCustomFieldColumns(projectId, "LIVING_LAB");
  const [fieldsLab, setFieldsLab] = useState<{ id: string; name: string } | null>(null);
  const [labs, setLabs] = useState(initialLabs);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<any | null>(null);
  const [activeLab, setActiveLab] = useState<string | null>(null);
  const { sortKey, sortDir, toggleSort } = useSort("smartvie:sort:living-labs");

  const grandTotal = labs.reduce((s, l) => s + l.costs.reduce((a: number, c: any) => a + Number(c.estBudget), 0), 0);
  const grandSpend = labs.reduce((s, l) => s + l.costs.reduce((a: number, c: any) => a + Number(c.actualSpend), 0), 0);

  function openAddModal(labId: string) {
    setActiveLab(labId);
    setEditingCost(null);
    setModalOpen(true);
  }

  function openEditModal(labId: string, cost: any) {
    setActiveLab(labId);
    setEditingCost(cost);
    setModalOpen(true);
  }

  function handleSaved(saved: any, isEdit: boolean) {
    setLabs(prev => prev.map(lab => {
      if (lab.id !== activeLab) return lab;
      if (isEdit) {
        return { ...lab, costs: lab.costs.map((c: any) => c.id === saved.id ? saved : c) };
      } else {
        return { ...lab, costs: [...lab.costs, saved] };
      }
    }));
  }

  async function handleDelete(labId: string, costId: string) {
    if (!await confirmDialog("Delete this cost item?")) return;
    const res = await clientFetch(`/api/living-labs/${labId}/costs/${costId}`, { method: "DELETE" });
    if (res.ok) {
      setLabs(prev => prev.map(lab => {
        if (lab.id !== labId) return lab;
        return { ...lab, costs: lab.costs.filter((c: any) => c.id !== costId) };
      }));
    }
  }

  return (
    <>
      <Topbar
        title="Living Labs"
        subtitle={`${labs.length} labs · ${formatCurrency(grandTotal)} total budget`}
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle>Total Budget</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{formatCurrency(grandTotal)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Actual Spend</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold text-primary">{formatCurrency(grandSpend)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Remaining</CardTitle></CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${grandTotal - grandSpend < 0 ? "text-red-600" : "text-emerald-600"}`}>
                {formatCurrency(grandTotal - grandSpend)}
              </p>
            </CardContent>
          </Card>
        </div>

        {labs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No living lab data yet. Run the import script to load your data.
            </CardContent>
          </Card>
        )}

        {labs.map(lab => {
          const labSpend = lab.costs.reduce((s: number, c: any) => s + Number(c.actualSpend), 0);
          const labBudget = lab.costs.reduce((s: number, c: any) => s + Number(c.estBudget), 0);
          const spendPct = labBudget > 0 ? (labSpend / labBudget) * 100 : 0;

          return (
            <Card key={lab.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{lab.name}</CardTitle>
                    {lab.location && (
                      <p className="text-xs text-muted-foreground mt-0.5">{lab.location}</p>
                    )}
                    {cf.columns.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {cf.columns.map((c) => {
                          const v = cf.cell(lab.id, c);
                          return v === "—" ? null : (
                            <span key={c.id} className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">{c.name}: {v}</span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-lg font-bold">{formatCurrency(labBudget)}</p>
                      <p className="text-xs text-muted-foreground">{formatCurrency(labSpend)} spent</p>
                    </div>
                    {cf.columns.length > 0 && (
                      <Button size="sm" variant="outline" onClick={() => setFieldsLab({ id: lab.id, name: lab.name })}>
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Fields
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openAddModal(lab.id)}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add Cost
                    </Button>
                  </div>
                </div>
                <Progress value={spendPct} showLabel className="mt-2" />
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border border-t">
                      <SortableTh label="Category" sortKey="category" activeKey={sortKey} direction={sortDir} onSort={toggleSort} className="px-5" />
                      <SortableTh label="Owner" sortKey="owner" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                      <SortableTh label="Est. Budget" sortKey="estBudget" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right" />
                      <SortableTh label="Actual Spend" sortKey="actualSpend" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right" />
                      <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lab.costs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground text-xs">
                          No cost items yet. Click &apos;Add Cost&apos; to add one.
                        </td>
                      </tr>
                    ) : (
                      sortItems(lab.costs, costAccessors, sortKey, sortDir).map((cost: any) => (
                        <tr key={cost.id} className="hover:bg-muted/20">
                          <td className="px-5 py-2.5">{cost.categoryName ?? "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{cost.owner?.name ?? "—"}</td>
                          <td className="px-3 py-2.5 text-right">{formatCurrency(Number(cost.estBudget))}</td>
                          <td className="px-3 py-2.5 text-right font-medium">{formatCurrency(Number(cost.actualSpend))}</td>
                          <td className="px-5 py-2.5 text-right">
                            <div className="flex gap-1 justify-end">
                              <button onClick={() => openEditModal(lab.id, cost)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-muted-foreground">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDelete(lab.id, cost.id)} className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/20">
                      <td colSpan={2} className="px-5 py-2.5 text-xs font-medium text-muted-foreground">
                        {lab.costs.length} line items
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold">
                        {formatCurrency(lab.costs.reduce((s: number, c: any) => s + Number(c.estBudget), 0))}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold">{formatCurrency(labSpend)}</td>
                      <td className="px-5 py-2.5" />
                    </tr>
                  </tfoot>
                </table>
              </CardContent>
            </Card>
          );
        })}
      </main>

      {activeLab && (
        <LivingLabCostModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          labId={activeLab}
          cost={editingCost}
          users={users}
          onSaved={handleSaved}
        />
      )}
      <LivingLabFieldsModal
        open={!!fieldsLab}
        onOpenChange={(o) => { if (!o) setFieldsLab(null); }}
        lab={fieldsLab}
        projectId={projectId}
        onSaved={cf.reload}
      />
    </>
  );
}
