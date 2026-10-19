"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { AccountMenu } from "@/components/layout/account-menu";
import { useFrameUser } from "@/components/layout/user-context";

interface Crumb {
  label: string;
  href?: string;
}

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Crumb[];
}

export function Topbar({ title, subtitle, actions, breadcrumbs }: TopbarProps) {
  const user = useFrameUser();
  const trail: Crumb[] = [...(user?.orgName ? [{ label: user.orgName }] : []), ...(breadcrumbs ?? [])];
  return (
    <header className="flex items-center justify-between min-h-16 pl-16 pr-4 lg:px-8 py-2 border-b border-border bg-card shrink-0 sticky top-0 z-30">
      <div className="min-w-0">
        {trail.length > 0 && (
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
            {trail.map((crumb, i) => {
              const last = i === trail.length - 1;
              return (
                <span key={i} className="flex items-center gap-1.5">
                  {i > 0 && <ChevronRight className="w-3 h-3 opacity-60" aria-hidden />}
                  {crumb.href && !last ? (
                    <Link href={crumb.href} className="hover:text-primary underline-offset-2 hover:underline">{crumb.label}</Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className={last ? "font-semibold text-foreground" : undefined}>{crumb.label}</span>
                  )}
                </span>
              );
            })}
          </nav>
        )}
        <h1 className="text-xl font-bold text-foreground truncate">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {actions}
        <AccountMenu />
      </div>
    </header>
  );
}
