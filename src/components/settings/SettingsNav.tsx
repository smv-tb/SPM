"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface SettingsNavGroup {
  label: string;
  items: { href: string; label: string }[];
}

/** Section menu for /settings. Items the caller can't use are left out by the layout. */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();
  // The most specific match wins, so /settings/project/tags doesn't also light up /settings/project.
  const active = groups
    .flatMap((g) => g.items)
    .filter((i) => pathname === i.href || pathname.startsWith(i.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label="Settings sections"
      className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-border bg-card md:min-h-screen px-4 md:px-3 py-3 md:py-6 overflow-x-auto"
    >
      <div className="flex md:flex-col gap-4 md:gap-5">
        {groups.map((group) => (
          <div key={group.label} className="shrink-0">
            <p className="px-3 mb-1 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground truncate max-w-[13rem]">
              {group.label}
            </p>
            <ul className="flex md:flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={item.href === active ? "page" : undefined}
                    className={cn(
                      "block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
                      item.href === active
                        ? "bg-primary/5 text-primary font-semibold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
