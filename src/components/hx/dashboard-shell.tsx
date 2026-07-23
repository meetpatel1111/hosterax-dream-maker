import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutGrid, Rocket, Database, Activity, Settings, LogOut, Plus, Terminal, KeyRound, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./logo";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/dashboard", label: "Projects", icon: LayoutGrid },
  { to: "/deployments", label: "Deployments", icon: Rocket },
  { to: "/databases", label: "Databases", icon: Database },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/tokens", label: "API tokens", icon: KeyRound },
  { to: "/oauth", label: "OAuth apps", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <Link to="/dashboard"><Logo /></Link>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          <Link
            to="/new"
            className="mb-3 flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New project
          </Link>
          {NAV.map((n) => {
            const active = loc.pathname === n.to || (n.to !== "/dashboard" && loc.pathname.startsWith(n.to));
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 flex items-center gap-2 rounded-md px-2 py-1.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
              {user?.email?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="min-w-0 flex-1 truncate text-xs">
              <div className="truncate font-medium">{user?.email}</div>
              <div className="text-muted-foreground">Free plan</div>
            </div>
          </div>
          <button
            onClick={async () => { await signOut(); nav({ to: "/auth" }); }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Control plane · connected
            </span>
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
