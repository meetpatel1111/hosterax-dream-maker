import { createFileRoute } from "@tanstack/react-router";
import { ObservabilityStudio } from "@/components/hx/observability-studio";

export const Route = createFileRoute("/_app/monitoring")({
  head: () => ({
    meta: [
      { title: "Observability & Alert Rules — HosteraX" },
      {
        name: "description",
        content:
          "Production node observability, live utilization charts, Prometheus metrics exporter, and threshold alert rules.",
      },
    ],
  }),
  component: MonitoringPage,
});

function MonitoringPage() {
  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      <ObservabilityStudio />
    </div>
  );
}
