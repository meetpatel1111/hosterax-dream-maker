import { createFileRoute } from "@tanstack/react-router";
import { PreviewEnvironmentsManager } from "@/components/hx/preview-environments-manager";

export const Route = createFileRoute("/_app/previews")({
  head: () => ({
    meta: [
      { title: "Preview Environments & PR Staging — HosteraX" },
      {
        name: "description",
        content:
          "Automatic ephemeral staging environments for GitHub Pull Requests, custom subdomains, scale-to-zero auto-hibernation, and PR bot comments.",
      },
    ],
  }),
  component: PreviewsPage,
});

function PreviewsPage() {
  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      <PreviewEnvironmentsManager />
    </div>
  );
}
