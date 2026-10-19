"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, Moon, Settings, Sun, SunDim } from "lucide-react";
import { THEMES, THEME_STORAGE_KEY, type ThemeId } from "@/lib/theme";
import { useFrameUser } from "@/components/layout/user-context";

function currentTheme(): ThemeId {
  const t = document.documentElement.getAttribute("data-theme");
  return THEMES.some((x) => x.id === t) ? (t as ThemeId) : "crisp";
}

const THEME_ICONS = { crisp: Sun, parchment: SunDim, dark: Moon } as const;

function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeId>("crisp");
  useEffect(() => setTheme(currentTheme()), []);

  function cycle() {
    const next = THEMES[(THEMES.findIndex((t) => t.id === theme) + 1) % THEMES.length]!;
    setTheme(next.id);
    if (next.id === "crisp") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next.id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next.id);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }

  const label = THEMES.find((t) => t.id === theme)!.label;
  const next = THEMES[(THEMES.findIndex((t) => t.id === theme) + 1) % THEMES.length]!.label;
  const Icon = THEME_ICONS[theme];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${label}. Switch to ${next}`}
      title={`Theme: ${label}`}
      className="grid place-items-center min-h-[44px] min-w-[44px] md:min-h-[32px] md:min-w-[32px] rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2"
    >
      <Icon className="w-4 h-4" aria-hidden />
    </button>
  );
}

export function AccountMenu() {
  const user = useFrameUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = user?.name || "Account";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

  return (
    <div className="flex items-center gap-1">
    <ThemeToggle />
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 min-h-[44px] md:min-h-[32px] pl-1 pr-2 rounded-md hover:bg-accent focus-visible:outline-2"
      >
        <span aria-hidden className="grid place-items-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
          {initials}
        </span>
        <span className="hidden sm:block text-left leading-tight">
          <span className="block text-sm font-semibold text-foreground">{name}</span>
          {user?.roleLabel && <span className="block text-xs text-muted-foreground">{user.roleLabel}</span>}
        </span>
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 mt-1 w-64 rounded-md border border-border bg-popover text-popover-foreground shadow-[var(--shadow-elevated)] z-50 py-1">
          <Link role="menuitem" href="/settings/security" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent min-h-[36px]">
            <Settings className="w-4 h-4" aria-hidden /> Account settings
          </Link>
          <button
            role="menuitem"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent min-h-[36px]"
          >
            <LogOut className="w-4 h-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
    </div>
  );
}
