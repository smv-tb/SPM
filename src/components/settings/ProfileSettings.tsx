"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientFetch } from "@/lib/client-fetch";

interface Props {
  name: string;
  email: string;
  role: string;
  twoFactor: boolean;
  defaultProjectId: string | null;
  projects: { id: string; name: string }[];
}

type Status = { kind: "ok" | "error"; text: string } | null;

async function save(url: string, method: string, body: unknown): Promise<Status> {
  const res = await clientFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return { kind: "ok", text: "Saved" };
  const data = await res.json().catch(() => ({}));
  return { kind: "error", text: typeof data.error === "string" ? data.error : "Could not save" };
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p role={status.kind === "error" ? "alert" : "status"} className={`text-sm ${status.kind === "error" ? "text-red-700" : "text-emerald-700"}`}>
      {status.text}
    </p>
  );
}

export function ProfileSettings({ name, email, role, twoFactor, defaultProjectId, projects }: Props) {
  const router = useRouter();
  const [draftName, setDraftName] = useState(name);
  const [nameStatus, setNameStatus] = useState<Status>(null);
  const [savingName, setSavingName] = useState(false);
  const [defaultId, setDefaultId] = useState(defaultProjectId ?? "");
  const [defaultStatus, setDefaultStatus] = useState<Status>(null);
  const [savingDefault, setSavingDefault] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Your details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setSavingName(true);
              setNameStatus(await save("/api/account/profile", "PATCH", { name: draftName }));
              setSavingName(false);
              router.refresh();
            }}
          >
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="profile-name">Name</Label>
              <Input id="profile-name" required maxLength={100} value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Email</dt>
                <dd className="font-medium break-all">{email}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Role</dt>
                <dd className="font-medium">{role}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Two-factor sign-in</dt>
                <dd className="font-medium">
                  {twoFactor ? "On" : "Off"} · <Link href="/settings/security" className="text-primary hover:underline">Security</Link>
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">Your email and role are changed by an Admin.</p>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={savingName || !draftName.trim() || draftName.trim() === name}>
                {savingName && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save name
              </Button>
              <StatusLine status={nameStatus} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Default project</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setSavingDefault(true);
              setDefaultStatus(await save("/api/account/default-project", "PUT", { projectId: defaultId || null }));
              setSavingDefault(false);
              router.refresh();
            }}
          >
            <div className="space-y-2 max-w-sm">
              <Label htmlFor="profile-default-project">Open this project when I haven&apos;t chosen one</Label>
              <select
                id="profile-default-project"
                value={defaultId}
                onChange={(e) => setDefaultId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
              >
                <option value="">The oldest active project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={savingDefault || defaultId === (defaultProjectId ?? "")}>
                {savingDefault && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
              </Button>
              <StatusLine status={defaultStatus} />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
