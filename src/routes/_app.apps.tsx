import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { OneClickAppsCatalog } from "@/components/hx/one-click-apps-catalog";
import { StarterTemplatesCatalog } from "@/components/hx/starter-templates-catalog";
import { Sparkles, Layers, Box, Search, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_app/apps")({
  head: () => ({
    meta: [
      { title: "App Store & Catalog — HosteraX" },
      {
        name: "description",
        content:
          "Browse 2,550+ Awesome-Selfhosted applications and starter templates for 1-click deployment.",
      },
    ],
  }),
  component: AppsCatalogPage,
});

function AppsCatalogPage() {
  const [catalogSection, setCatalogSection] = useState<"one-click" | "templates">("one-click");

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-primary uppercase tracking-wider">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Software Directory & Templates</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">App Store & Catalog</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Discover, install, and run 2,550+ self-hosted software packages and starter templates
            with zero-config.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-1 shadow-sm">
          <button
            onClick={() => setCatalogSection("one-click")}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              catalogSection === "one-click"
                ? "bg-primary text-primary-foreground shadow-sm glow-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-surface"
            }`}
          >
            <span>🐳</span>
            <span>One-Click Apps (2,550+)</span>
          </button>
          <button
            onClick={() => setCatalogSection("templates")}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              catalogSection === "templates"
                ? "bg-primary text-primary-foreground shadow-sm glow-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-surface"
            }`}
          >
            <span>⚡</span>
            <span>Starter Templates (42+)</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="animate-in fade-in duration-200">
        {catalogSection === "one-click" ? <OneClickAppsCatalog /> : <StarterTemplatesCatalog />}
      </div>
    </div>
  );
}
