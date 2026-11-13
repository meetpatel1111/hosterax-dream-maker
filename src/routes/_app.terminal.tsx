import { createFileRoute } from "@tanstack/react-router";
import { WebShellStudio } from "@/components/hx/web-shell-studio";

export const Route = createFileRoute("/_app/terminal")({
  validateSearch: (search: Record<string, unknown>): { container?: string } => ({
    container: typeof search.container === "string" ? search.container : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Web Terminal & Exec Studio — HosteraX" },
      {
        name: "description",
        content:
          "Live multi-container interactive web shell and Docker exec workbench with audit trail and diagnostic runbooks.",
      },
    ],
  }),
  component: TerminalPage,
});

function TerminalPage() {
  const { container } = Route.useSearch();
  return (
    <div className="w-full max-w-[1720px] 2xl:max-w-none mx-auto space-y-6 transition-all duration-300">
      <WebShellStudio initialContainer={container || undefined} />
    </div>
  );
}
