import { useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutGrid,
  Rocket,
  Database,
  Activity,
  Settings,
  LogOut,
  Plus,
  Terminal,
  KeyRound,
  ShieldCheck,
  Cpu,
  Globe,
  Boxes,
  Sparkles,
  Clock,
  Users,
  Mail,
  Building,
  ChevronDown,
  Languages,
} from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import { useAuth } from "@/lib/auth-context";
import { useOrganizations } from "@/lib/engine";
import { useTranslation, LANGUAGES, type LanguageCode } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", key: "projects" as const, label: "Projects", icon: LayoutGrid },
  { to: "/apps", key: "apps" as const, label: "App Store", icon: Sparkles },
  { to: "/dockerhub", key: "quickDeploy" as const, label: "Registries", icon: Boxes },
  { to: "/deployments", key: "deploy" as const, label: "Deployments", icon: Rocket },
  { to: "/jobs", key: "jobs" as const, label: "Jobs & Schedules", icon: Clock },
  { to: "/domains", key: "domains" as any, label: "Domains & SSL", icon: Globe },
  { to: "/databases", key: "databases" as const, label: "Databases", icon: Database },
  { to: "/servers", key: "servers" as const, label: "Servers", icon: Cpu },
  { to: "/team", key: "team" as const, label: "Team & RBAC", icon: Users },
  { to: "/mail", key: "mail" as const, label: "Mailboxes", icon: Mail },
  { to: "/activity", key: "activity" as any, label: "Activity", icon: Activity },
  { to: "/tokens", key: "tokens" as any, label: "API Tokens", icon: KeyRound },
  { to: "/oauth", key: "oauth" as any, label: "OAuth Apps", icon: ShieldCheck },
  { to: "/settings", key: "settings" as const, label: "Settings", icon: Settings },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const { data: orgs = [] } = useOrganizations();
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const { t, language, setLanguage, isRtl } = useTranslation();

  const currentOrg = orgs.find((o) => (activeOrgId ? o.id === activeOrgId : true)) || orgs[0];

  return (
    <div className={cn("flex min-h-screen bg-background text-foreground", isRtl && "font-arabic")}>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        {/* Top Logo & Workspace Switcher */}
        <div className="flex flex-col border-b border-sidebar-border p-3 gap-2">
          <div className="flex h-10 items-center justify-between px-1">
            <Link to="/dashboard">
              <Logo />
            </Link>
          </div>

          {/* Organization / Workspace Switcher */}
          {orgs.length > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-sidebar-accent/50 border border-sidebar-border/60 p-2 text-xs">
              <div className="flex items-center gap-2 truncate">
                <Building className="w-3.5 h-3.5 text-primary shrink-0" />
                <select
                  value={currentOrg?.id}
                  onChange={(e) => setActiveOrgId(e.target.value)}
                  className="bg-transparent font-medium text-xs text-sidebar-foreground outline-none cursor-pointer truncate max-w-[130px]"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id} className="bg-sidebar text-sidebar-foreground">
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground uppercase">
                {currentOrg?.plan || "Pro"}
              </span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto max-h-[calc(100vh-210px)]">
          <Link
            to="/new"
            className="mb-3 flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 shadow-sm"
          >
            <Plus className="h-4 w-4" /> {t("newProject", "New Project")}
          </Link>
          {NAV.map((n) => {
            const active =
              loc.pathname === n.to || (n.to !== "/dashboard" && loc.pathname.startsWith(n.to));
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" /> {t(n.key as any, n.label)}
              </Link>
            );
          })}
        </nav>

        {/* Footer with Language Switcher & User Account */}
        <div className="border-t border-sidebar-border p-3 space-y-2">
          {/* i18n Language Dropdown */}
          <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground bg-sidebar-accent/30 rounded-md">
            <div className="flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-primary" />
              <span className="text-[11px]">Language</span>
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
              className="bg-transparent text-[11px] font-medium text-foreground outline-none cursor-pointer"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} className="bg-sidebar text-sidebar-foreground">
                  {l.flag} {l.nativeName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
              {user?.email?.[0]?.toUpperCase() ?? "A"}
            </div>
            <div className="min-w-0 flex-1 truncate text-xs">
              <div className="truncate font-medium">{user?.email || "admin@hosterax.internal"}</div>
              <div className="text-muted-foreground text-[10px]">Primary Workspace</div>
            </div>
          </div>
          <button
            onClick={async () => {
              await signOut();
              nav({ to: "/auth" });
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> {t("logout", "Sign out")}
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="flex h-14 items-center justify-between border-b border-border bg-background/60 px-6 backdrop-blur">
          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Terminal className="h-3.5 w-3.5 text-primary" />
            <span>hx</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="truncate">{loc.pathname}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t("systemHealthy", "Control plane · connected")}
            </span>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
