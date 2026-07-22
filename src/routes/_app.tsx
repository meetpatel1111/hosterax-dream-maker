import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { DashboardShell } from "@/components/hx/dashboard-shell";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        <span className="animate-pulse font-mono">initializing control plane...</span>
      </div>
    );
  }
  if (!session) return <Navigate to="/auth" />;
  return <DashboardShell><Outlet /></DashboardShell>;
}
