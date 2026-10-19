"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, FolderOpen, Loader2, Plus, Star, Trash2, Users } from "lucide-react";
import { ProjectMembersDialog, type MemberCandidate } from "@/components/settings/ProjectMembersDialog";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { clientFetch } from "@/lib/client-fetch";
import { formatDate } from "@/lib/utils";

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
  counts: { milestones: number; tasks: number; fundingRecords: number };
}

interface Props {
  projects: ProjectRow[];
  currentProjectId: string | null;
  defaultProjectId: string | null;
  canCreate: boolean;
  canArchive: boolean;
  canDelete: boolean;
  /** Administrators only: manage who can open each project. */
  canManageMembers?: boolean;
  memberCandidates?: MemberCandidate[];
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

export function ProjectsManager({ projects, currentProjectId, defaultProjectId, canCreate, canArchive, canDelete, canManageMembers = false, memberCandidates = [] }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [membersOf, setMembersOf] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(projects.length === 0 && canCreate);
  const [form, setForm] = useState({ name: "", description: "", startDate: "", endDate: "", templateProjectId: "" });

  const active = projects.filter((p) => !p.archivedAt);
  const archived = projects.filter((p) => p.archivedAt);
  const shown = showArchived ? projects : active;

  async function run(key: string, action: () => Promise<Response>, fallback: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(await errorOf(res, fallback));
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  const post = (url: string, body: unknown, method = "POST") =>
    clientFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    let newId: string | null = null;
    const ok = await run(
      "create",
      async () => {
        const res = await post("/api/project", {
          name: form.name,
          description: form.description || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          templateProjectId: form.templateProjectId || null,
        });
        if (res.ok) newId = (await res.clone().json()).id;
        return res;
      },
      "Could not create the project"
    );
    if (ok && newId) {
      // Open the new project straight away.
      await post("/api/account/current-project", { projectId: newId });
      setForm({ name: "", description: "", startDate: "", endDate: "", templateProjectId: "" });
      setCreating(false);
      router.refresh();
    }
  }

  async function remove(p: ProjectRow) {
    if (!(await confirmDialog({ message: `Delete "${p.name}" and everything in it? This cannot be undone.`, confirmLabel: "Delete project" }))) return;
    void run(`delete:${p.id}`, () => clientFetch(`/api/project/${p.id}`, { method: "DELETE" }), "Could not delete the project");
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Projects ({active.length} active{archived.length ? `, ${archived.length} archived` : ""})</CardTitle>
            <div className="flex items-center gap-2">
              {archived.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
                  {showArchived ? "Hide archived" : "Show archived"}
                </Button>
              )}
              {canCreate && !creating && (
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> New project
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {shown.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              {canCreate ? "No projects yet." : "You haven't been added to any project yet. Ask an administrator to add you."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-left text-xs font-medium text-muted-foreground">
                  <th className="px-5 py-2">Project</th>
                  <th className="px-3 py-2 whitespace-nowrap">Dates</th>
                  <th className="px-3 py-2 whitespace-nowrap text-right">Milestones</th>
                  <th className="px-3 py-2 whitespace-nowrap text-right">Tasks</th>
                  <th className="px-3 py-2 whitespace-nowrap text-right">Funding</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((p) => {
                  const isDefault = p.id === defaultProjectId;
                  return (
                    <tr key={p.id} className={p.archivedAt ? "bg-muted/30 text-muted-foreground" : "hover:bg-muted/20"}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground">{p.name}</span>
                          {p.id === currentProjectId && <Badge variant="info" size="sm">Open</Badge>}
                          {isDefault && <Badge variant="neutral" size="sm">Default</Badge>}
                          {p.archivedAt && <Badge variant="warning" size="sm">Archived {formatDate(p.archivedAt)}</Badge>}
                        </div>
                        {p.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{p.description}</p>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs">
                        {p.startDate ? formatDate(p.startDate) : "—"} → {p.endDate ? formatDate(p.endDate) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.counts.milestones}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.counts.tasks}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{p.counts.fundingRecords}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {!p.archivedAt && p.id !== currentProjectId && (
                            <Button variant="ghost" size="sm" title="Open this project" disabled={!!busy}
                              onClick={() => run(`open:${p.id}`, () => post("/api/account/current-project", { projectId: p.id }), "Could not open the project")}>
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span className="sr-only">Open {p.name}</span>
                            </Button>
                          )}
                          {!p.archivedAt && (
                            <Button variant="ghost" size="sm" title={isDefault ? "Stop opening this by default" : "Open this by default"} disabled={!!busy}
                              aria-pressed={isDefault}
                              onClick={() => run(`default:${p.id}`, () => post("/api/account/default-project", { projectId: isDefault ? null : p.id }, "PUT"), "Could not change your default project")}>
                              <Star className={`w-3.5 h-3.5 ${isDefault ? "fill-amber-400 text-amber-500" : ""}`} />
                              <span className="sr-only">{isDefault ? "Unset default" : "Set as default"}</span>
                            </Button>
                          )}
                          {canManageMembers && (
                            <Button variant="ghost" size="sm" title="Who can open this project" disabled={!!busy}
                              onClick={() => setMembersOf({ id: p.id, name: p.name })}>
                              <Users className="w-3.5 h-3.5" />
                              <span className="sr-only">Members of {p.name}</span>
                            </Button>
                          )}
                          {canArchive && (
                            <Button variant="ghost" size="sm" disabled={!!busy}
                              title={p.archivedAt ? "Restore" : "Archive: keeps everything, makes it read-only"}
                              onClick={async () => {
                                if (!p.archivedAt && !(await confirmDialog({ message: `Archive "${p.name}"? It becomes read-only and leaves the project list and totals. You can restore it at any time.`, title: "Archive this project?", confirmLabel: "Archive project", destructive: false }))) return;
                                void run(`archive:${p.id}`, () => post(`/api/project/${p.id}/archive`, { archived: !p.archivedAt }), "Could not change the project");
                              }}>
                              {busy === `archive:${p.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : p.archivedAt ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                              <span className="sr-only">{p.archivedAt ? "Restore" : "Archive"} {p.name}</span>
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="sm" disabled={!!busy} title="Delete (only a project that never held money)" onClick={() => remove(p)}>
                              {busy === `delete:${p.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 text-red-600" />}
                              <span className="sr-only">Delete {p.name}</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canCreate && creating && (
        <Card>
          <CardHeader>
            <CardTitle>New project</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-4 max-w-xl">
              <div className="space-y-2">
                <Label htmlFor="project-name">Name</Label>
                <Input id="project-name" required maxLength={255} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-description">Description (optional)</Label>
                <textarea
                  id="project-description"
                  value={form.description}
                  maxLength={2000}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="project-start">Start date</Label>
                  <Input id="project-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-end">End date</Label>
                  <Input id="project-end" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>
              {projects.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="project-template">Start from</Label>
                  <select
                    id="project-template"
                    value={form.templateProjectId}
                    onChange={(e) => setForm({ ...form, templateProjectId: e.target.value })}
                    className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
                  >
                    <option value="">A blank project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        A copy of {p.name}&apos;s phases, tags and custom fields
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">Only the structure is copied — never tasks, people or money.</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy === "create"}>
                  {busy === "create" ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</> : "Create project"}
                </Button>
                {projects.length > 0 && (
                  <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <ProjectMembersDialog project={membersOf} candidates={memberCandidates} onClose={() => setMembersOf(null)} />
    </div>
  );
}
