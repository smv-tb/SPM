"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { clientFetch } from "@/lib/client-fetch";
import { ALL_PROJECTS } from "@/lib/project-scope";

interface Props {
  projects: { id: string; name: string }[];
  /** What the cookie resolves to where the portfolio view is allowed (may be "all"). */
  currentId: string | null;
  /** What every other screen resolves to. */
  fallbackId: string | null;
}

/** Only the dashboard can add projects up; everywhere else shows one project. */
const PORTFOLIO_PATHS = ["/dashboard"];

export function ProjectSwitcher({ projects, currentId, fallbackId }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const portfolio = PORTFOLIO_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const value = portfolio && projects.length > 1 ? currentId : fallbackId;

  if (projects.length === 0) {
    return (
      <Link href="/settings/projects" className="block mb-3 px-4 py-2.5 rounded-md border border-dashed border-[#6B7C73] text-sm text-sidebar-foreground hover:bg-white/5">
        Create your first project
      </Link>
    );
  }

  async function choose(projectId: string) {
    setError(null);
    const res = await clientFetch("/api/account/current-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    if (!res.ok) {
      setError("Could not switch project");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="mb-3">
      <label htmlFor="project-switcher" className="flex items-center gap-1.5 px-1 mb-1.5 text-xs font-semibold text-sidebar-foreground">
        <FolderKanban className="w-3 h-3" /> Project
      </label>
      <select
        id="project-switcher"
        value={value ?? ""}
        disabled={pending}
        onChange={(e) => {
          if (e.target.value === "__manage") router.push("/settings/projects");
          else void choose(e.target.value);
        }}
        className="w-full h-10 px-3 rounded-md bg-black/25 border border-[#6B7C73] text-sm text-white focus-visible:outline-2 focus-visible:outline-sidebar-active disabled:opacity-60"
      >
        {portfolio && projects.length > 1 && <option value={ALL_PROJECTS}>All projects</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value="__manage">Manage projects…</option>
      </select>
      {error && <p role="alert" className="mt-1 px-1 text-xs text-[#F0A58F]">{error}</p>}
    </div>
  );
}
