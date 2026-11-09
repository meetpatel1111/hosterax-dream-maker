import { createFileRoute } from "@tanstack/react-router";
import { VisualStackBuilder } from "@/components/hx/visual-stack-builder";

export const Route = createFileRoute("/_app/stacks")({
  head: () => ({
    meta: [
      { title: "Docker Compose & Stacks — HosteraX" },
      {
        name: "description",
        content:
          "Visual multi-service Docker Compose topology builder. Drag, wire, and deploy full-stack container architectures with instant YAML export.",
      },
    ],
  }),
  component: StacksPage,
});

function StacksPage() {
  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      <VisualStackBuilder />
    </div>
  );
}
