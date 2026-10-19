"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Pencil, Leaf } from "lucide-react";
import { toast } from "sonner";
import { clientFetch } from "@/lib/client-fetch";
import { formatCurrency } from "@/lib/utils";
import { useCustomFieldColumns } from "@/components/ui/custom-field-columns";
import { ProjectForm, type ProjectFormValues } from "./ProjectForm";
import type { Project } from "./types";

/** An empty date field means "no date", which the API takes as null. */
const dateOrNull = (v: string | undefined) => (v ? v : null);

export function ProjectGeneral({ project, historicalSpend, canEdit }: { project: Project; historicalSpend: number; canEdit: boolean }) {
  const router = useRouter();
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const cf = useCustomFieldColumns(project.id, "PROJECT");

  const handleProjectSave = async (data: ProjectFormValues) => {
    const res = await clientFetch("/api/project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: project.id,
        name: data.name,
        description: data.description || null,
        startDate: dateOrNull(data.startDate),
        endDate: dateOrNull(data.endDate),
        logoUrl: data.logoUrl || null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to save project");
    }
    toast.success("Project updated");
    cf.reload();
    router.refresh();
  };

  const fmt = (d?: Date | null) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-semibold">Project information</CardTitle>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => setIsProjectModalOpen(true)}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          {project.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.logoUrl} alt="Project logo" className="w-16 h-16 rounded-lg object-cover border" />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
              <Leaf className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          <div>
            <h4 className="font-bold text-lg">{project.name}</h4>
            <p className="text-sm text-muted-foreground line-clamp-2">{project.description || "No description provided."}</p>
          </div>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Start</dt>
            <dd className="font-medium">{fmt(project.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">End</dt>
            <dd className="font-medium">{fmt(project.endDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Historical spend (pre-system)</dt>
            <dd className="font-medium">
              {formatCurrency(historicalSpend)}
              <span className="block text-xs font-normal text-muted-foreground">Edited on the Funding page; it feeds the runway.</span>
            </dd>
          </div>
          {cf.columns.map((c) => (
            <div key={c.id}>
              <dt className="text-xs text-muted-foreground">{c.name}</dt>
              <dd className="font-medium">{cf.cell(project.id, c)}</dd>
            </div>
          ))}
        </dl>
        {!canEdit && <p className="text-xs text-muted-foreground">Only a PM or Admin can change the project details.</p>}
      </CardContent>
      {canEdit && (
        <ProjectForm open={isProjectModalOpen} onOpenChange={setIsProjectModalOpen} initialData={project} onSave={handleProjectSave} />
      )}
    </Card>
  );
}
