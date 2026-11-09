import { createFileRoute } from "@tanstack/react-router";
import { StatusPageManager } from "@/components/hx/status-page-manager";

export const Route = createFileRoute("/_app/status")({
  head: () => ({
    meta: [
      { title: "Status Page & Synthetic Uptime — HosteraX" },
      {
        name: "description",
        content:
          "Public and private status page generator, synthetic HTTP/TCP uptime probes, 90-day SLA analytics, and incident post-mortem hub.",
      },
    ],
  }),
  component: StatusPage,
});

function StatusPage() {
  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      <StatusPageManager />
    </div>
  );
}
