"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select-native";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { clientFetch } from "@/lib/client-fetch";
import { MEMBER_ROLES } from "@/lib/project-membership";

export interface MemberCandidate {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Member {
  userId: string;
  name: string;
  email: string;
  accountRole: string;
  isActive: boolean;
  role: string;
}

const ROLE_HELP: Record<string, string> = {
  PM: "Can edit project details and funding",
  CONTRIBUTOR: "Can log work and edit tasks and funding records",
  VIEWER: "Read-only",
};

/** Admin-only: who can open this project, and the most they can do in it (never more than their account allows). */
export function ProjectMembersDialog({
  project,
  candidates,
  onClose,
}: {
  project: { id: string; name: string } | null;
  candidates: MemberCandidate[];
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<string>("CONTRIBUTOR");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!project) return;
    const res = await clientFetch(`/api/project/${project.id}/members`);
    if (!res.ok) {
      setError("Could not load the members");
      return;
    }
    setMembers(await res.json());
  }, [project]);

  useEffect(() => {
    setMembers(null);
    setError("");
    setUserId("");
    void load();
  }, [load]);

  async function change(key: string, request: () => Promise<Response>) {
    setBusy(key);
    setError("");
    try {
      const res = await request();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  const put = (uid: string, r: string) =>
    clientFetch(`/api/project/${project!.id}/members`, { method: "PUT", body: JSON.stringify({ userId: uid, role: r }) });

  const memberIds = new Set((members ?? []).map((m) => m.userId));
  const available = candidates.filter((c) => !memberIds.has(c.id));

  return (
    <Dialog open={!!project} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Members of {project?.name}</DialogTitle>
          <DialogDescription>
            Administrators can open every project. Everyone else sees only the projects they are added to, and in each
            one can do the lower of their account role and the role set here.
          </DialogDescription>
        </DialogHeader>

        {members === null ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : (
          <div className="space-y-4">
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody but administrators can open this project yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {m.name}
                        {!m.isActive && <span className="ml-2 text-xs text-muted-foreground">(deactivated)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{m.email} · account role {m.accountRole.toLowerCase()}</p>
                    </div>
                    <Select
                      aria-label={`Role of ${m.name} in this project`}
                      className="w-40"
                      value={m.role}
                      disabled={busy !== null}
                      onChange={(e) => void change(`role:${m.userId}`, () => put(m.userId, e.target.value))}
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
                      ))}
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      title="Remove from this project"
                      onClick={() =>
                        void change(`remove:${m.userId}`, () =>
                          clientFetch(`/api/project/${project!.id}/members?userId=${encodeURIComponent(m.userId)}`, { method: "DELETE" })
                        )
                      }
                    >
                      {busy === `remove:${m.userId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                      <span className="sr-only">Remove {m.name}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[12rem]">
                <label htmlFor="member-user" className="block text-xs font-medium text-muted-foreground mb-1">Add someone</label>
                <Select id="member-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
                  <option value="">{available.length ? "Choose a person…" : "Everyone is already a member"}</option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.role.toLowerCase()})</option>
                  ))}
                </Select>
              </div>
              <div className="w-40">
                <label htmlFor="member-role" className="block text-xs font-medium text-muted-foreground mb-1">Role here</label>
                <Select id="member-role" value={role} onChange={(e) => setRole(e.target.value)} title={ROLE_HELP[role]}>
                  {MEMBER_ROLES.map((r) => (
                    <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
                  ))}
                </Select>
              </div>
              <Button disabled={!userId || busy !== null} onClick={() => void change("add", () => put(userId, role)).then(() => setUserId(""))}>
                {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />} Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{ROLE_HELP[role]}. A person&apos;s account role is the ceiling.</p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
