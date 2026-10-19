"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SUPPORT_EMAIL } from "@/lib/constants";
import {
  LayoutDashboard,
  Flag,
  CheckSquare,
  GanttChart,
  DollarSign,
  BookOpen,
  FileText,
  Undo2,
  Banknote,
  Landmark,
  NotebookPen,
  Contact,
  Package,
  Hourglass,
  Scale,
  TrendingUp,
  Users,
  FlaskConical,
  BarChart3,
  Settings,
  Shield,
  Leaf,
  HelpCircle,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  FolderKanban,
} from "lucide-react";
import { roleHasPermission, type Permission } from "@/lib/permissions";
import { ProjectSwitcher } from "@/components/layout/project-switcher";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  permission?: Permission;
  /** Match the path exactly, so an overview link is not lit on every child page. */
  exact?: boolean;
};

type NavGroup = {
  label: string;
  /** Hint under the label saying what the group follows. */
  hint: string;
  permission?: Permission;
  /** The company-wide finance group is marked and tinted apart from project work. */
  ledger?: boolean;
  /** Only the project group follows the project switcher. */
  withProjectSwitcher?: boolean;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Projects",
    hint: "Follows the selected project",
    withProjectSwitcher: true,
    items: [
      { href: "/dashboard",   label: "Dashboard",    icon: LayoutDashboard },
      { href: "/milestones",  label: "Milestones",   icon: Flag },
      { href: "/tasks",       label: "Tasks",        icon: CheckSquare },
      { href: "/gantt",       label: "Gantt",        icon: GanttChart },
      { href: "/funding",     label: "Funding",      icon: DollarSign },
      { href: "/resources",   label: "Resources",    icon: Users },
      { href: "/living-labs", label: "Living Labs",  icon: FlaskConical },
      { href: "/reports",     label: "Reports",      icon: BarChart3 },
    ],
  },
  {
    // The books are company-wide and PM+ only; the whole group is hidden below that.
    label: "Accounting",
    hint: "Company-wide, not per project",
    permission: "books:view",
    ledger: true,
    items: [
      { href: "/books",               label: "Overview",       icon: BookOpen, exact: true },
      { href: "/books/invoices",      label: "Invoices",       icon: FileText },
      { href: "/books/credit-notes",  label: "Credit notes",   icon: Undo2 },
      { href: "/books/payments",      label: "Payments",       icon: Banknote },
      { href: "/books/bank",          label: "Bank",           icon: Landmark },
      { href: "/books/journals",      label: "Journals",       icon: NotebookPen },
      { href: "/books/contacts",      label: "Contacts",       icon: Contact },
      { href: "/books/products",      label: "Products",       icon: Package },
      { href: "/books/aged-debtors",  label: "Aged debtors",   icon: Hourglass },
      { href: "/books/trial-balance", label: "Trial balance",  icon: Scale },
      { href: "/books/profit-and-loss", label: "Profit and loss", icon: TrendingUp },
      { href: "/books/balance-sheet", label: "Balance sheet",  icon: BarChart3 },
    ],
  },
];

const bottomItems = [
  { href: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  logoUrl?: string | null;
  userRole?: string | null;
  projects: { id: string; name: string }[];
  currentProjectId: string | null;
  fallbackProjectId: string | null;
}

const COLLAPSE_KEY = "pm_sidebar_collapsed";

function SidebarBody({
  logoUrl, userRole, projects, currentProjectId, fallbackProjectId, collapsed = false, onToggle,
}: SidebarProps & { collapsed?: boolean; onToggle?: () => void }) {
  const pathname = usePathname();

  const link = cn(
    "relative flex items-center gap-3 py-2 min-h-[36px] rounded-full text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sidebar-active",
    collapsed ? "justify-center w-11 h-11 mx-auto px-0" : "pl-4 pr-3"
  );
  /** Text that stays in the accessibility tree when the rail shows icons only. */
  const labelClass = collapsed ? "sr-only" : undefined;

  return (
    <>
      {/* Wordmark */}
      <div className={cn("flex items-center gap-3 py-6", collapsed ? "justify-center px-0" : "px-6")}>
        <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center shrink-0 overflow-hidden">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
          ) : (
            <Leaf className="w-5 h-5 text-white" aria-hidden />
          )}
        </div>
        <div className={labelClass}>
          <p className="text-2xl font-bold text-white leading-none">Smartvie</p>
          <p className="text-xs text-sidebar-foreground mt-1">Project manager</p>
        </div>
      </div>

      <nav aria-label="Main" className={cn("flex-1 space-y-4 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
        {navGroups
          .filter((group) => group.permission === undefined || roleHasPermission(userRole, group.permission))
          .map((group) => (
            <div
              key={group.label}
              aria-label={group.label}
              role="group"
              className={cn("rounded-2xl px-1 py-2", group.ledger && "bg-[#26242B] border-l-2 border-[#8E5A8A] rounded-2xl")}
            >
              <div className={cn("flex items-center gap-2 px-3 mb-0.5", collapsed && "sr-only")}>
                <p className="text-sm font-semibold text-white">{group.label}</p>
                {group.ledger && (
                  <span className="rounded-sm border border-[#C79BC1] px-1.5 text-xs font-semibold tracking-wide text-[#EBCDE7]">
                    LEDGER
                  </span>
                )}
              </div>
              <p className={cn("px-3 mb-2 text-xs text-sidebar-foreground", collapsed && "sr-only")}>{group.hint}</p>
              {group.withProjectSwitcher && !collapsed && (
                <div className="px-2">
                  <ProjectSwitcher projects={projects} currentId={currentProjectId} fallbackId={fallbackProjectId} />
                </div>
              )}
              {group.withProjectSwitcher && collapsed && (
                <button
                  type="button"
                  onClick={onToggle}
                  title="Project: open the menu to switch"
                  className={cn(link, "mb-1 border border-[#6B7C73] hover:bg-white/5 hover:text-white")}
                >
                  <FolderKanban className="w-[18px] h-[18px] shrink-0" aria-hidden />
                  <span className="sr-only">Switch project (expands the menu)</span>
                </button>
              )}
              <div className="space-y-0.5">
                {group.items
                  .filter((item) => item.permission === undefined || roleHasPermission(userRole, item.permission))
                  .map(({ href, label, icon: Icon, exact }) => {
                    const active = exact
                      ? pathname === href
                      : pathname === href || pathname.startsWith(href + "/");
                    return (
                      <Link
                        key={href}
                        href={href}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? label : undefined}
                        className={cn(
                          link,
                          active
                            ? cn("text-white font-semibold", group.ledger ? "bg-[#402941]" : "bg-sidebar-active/20")
                            : "hover:bg-white/5 hover:text-white"
                        )}
                      >
                        <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden />
                        <span className={labelClass}>{label}</span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}
      </nav>

      {/* Footer */}
      <div className={cn("py-4 mt-auto border-t border-[#2C3D34] space-y-0.5", collapsed ? "px-2" : "px-3")}>
        {bottomItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href) && !pathname.startsWith("/settings/admin");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? label : undefined}
              className={cn(link, active ? "bg-white/10 text-white font-semibold" : "hover:bg-white/5 hover:text-white")}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden />
              <span className={labelClass}>{label}</span>
            </Link>
          );
        })}
        {roleHasPermission(userRole, "users:manage") && (
          <Link
            href="/settings/admin/users"
            aria-current={pathname.startsWith("/settings/admin") ? "page" : undefined}
            title={collapsed ? "Admin" : undefined}
            className={cn(link, pathname.startsWith("/settings/admin") ? "bg-white/10 text-white font-semibold" : "hover:bg-white/5 hover:text-white")}
          >
            <Shield className="w-[18px] h-[18px] shrink-0" aria-hidden />
            <span className={labelClass}>Admin</span>
          </Link>
        )}
        {SUPPORT_EMAIL && (
          <Link href={`mailto:${SUPPORT_EMAIL}`} title={collapsed ? "Support" : undefined} className={cn(link, "hover:bg-white/5 hover:text-white")}>
            <HelpCircle className="w-[18px] h-[18px] shrink-0" aria-hidden />
            <span className={labelClass}>Support</span>
          </Link>
        )}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand menu" : undefined}
            className={cn(link, "w-full hover:bg-white/5 hover:text-white")}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-[18px] h-[18px] shrink-0" aria-hidden />
            ) : (
              <PanelLeftClose className="w-[18px] h-[18px] shrink-0" aria-hidden />
            )}
            <span className={labelClass}>{collapsed ? "Expand menu" : "Collapse menu"}</span>
          </button>
        )}
      </div>
    </>
  );
}

/** Persistent sidebar from lg up; a modal drawer below that. */
export function Sidebar(props: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  // Read after mount so the server and first client render agree.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage blocked: stays expanded */
    }
  }, []);
  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* the choice lasts for this page only */
      }
      return !c;
    });
  }

  return (
    <>
      <aside
        className={cn(
          "hidden lg:flex flex-col min-h-screen bg-sidebar text-sidebar-foreground shrink-0 transition-[width] motion-reduce:transition-none",
          collapsed ? "w-[4.5rem]" : "w-64"
        )}
      >
        <SidebarBody {...props} collapsed={collapsed} onToggle={toggle} />
      </aside>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            className="lg:hidden fixed top-3 left-3 z-40 grid place-items-center h-11 w-11 rounded-full bg-sidebar text-white focus-visible:outline-2 focus-visible:outline-sidebar-active"
          >
            <Menu className="w-5 h-5" aria-hidden />
            <span className="sr-only">Open navigation</span>
          </button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col rounded-r-[28px] bg-sidebar text-sidebar-foreground overflow-y-auto"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <DialogPrimitive.Close className="absolute right-3 top-3 grid place-items-center h-11 w-11 rounded-full text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sidebar-active">
              <X className="w-5 h-5" aria-hidden />
              <span className="sr-only">Close navigation</span>
            </DialogPrimitive.Close>
            <SidebarBody {...props} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
