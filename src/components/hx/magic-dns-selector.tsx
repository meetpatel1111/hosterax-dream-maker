import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useEngine, useMagicDnsSettings, formatMagicDnsUrl, MagicDnsProviderInfo } from "@/lib/engine";
import { toast } from "sonner";
import {
  Globe,
  CheckCircle2,
  Copy,
  ExternalLink,
  Sparkles,
  Radio,
  Wifi,
  ShieldCheck,
  Zap,
} from "lucide-react";

interface MagicDnsSelectorProps {
  projectName?: string;
  projectPort?: number;
  compact?: boolean;
  showTitle?: boolean;
  onProviderChanged?: (providerId: string) => void;
}

export function MagicDnsSelector({
  projectName,
  projectPort = 3000,
  compact = false,
  showTitle = true,
  onProviderChanged,
}: MagicDnsSelectorProps) {
  const engine = useEngine();
  const qc = useQueryClient();
  const { data: magicDns, isLoading } = useMagicDnsSettings();
  const [switching, setSwitching] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const activeProvider = magicDns?.activeProvider || "sslip.io";
  const providers = magicDns?.providers || [];

  async function handleSelectProvider(providerId: string) {
    if (providerId === activeProvider || switching) return;
    setSwitching(providerId);
    try {
      await engine.call("POST", "/api/settings/magic-dns", { provider: providerId });
      toast.success(`Magic DNS provider updated to ${providerId}`, {
        description: `All project wildcard URLs are now using ${providerId}`,
      });
      await qc.invalidateQueries({ queryKey: ["magic-dns-settings"] });
      await qc.invalidateQueries({ queryKey: ["engine-projects"] });
      await qc.invalidateQueries({ queryKey: ["project-domains"] });
      onProviderChanged?.(providerId);
    } catch (err: any) {
      toast.error(err.message || "Failed to update Magic DNS provider");
    } finally {
      setSwitching(null);
    }
  }

  function copyToClipboard(url: string) {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    toast.success("URL copied to clipboard");
    setTimeout(() => setCopiedUrl(null), 2000);
  }

  const sampleProjectName = projectName || "my-app";
  const currentSampleHost = formatMagicDnsUrl(sampleProjectName, activeProvider, projectPort);
  const currentDirectUrl = `http://${currentSampleHost}`;
  const currentProxyUrl = `http://${formatMagicDnsUrl(sampleProjectName, activeProvider, 7777)}`;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5 text-primary" />
          DNS Wildcard:
        </span>
        <div className="flex flex-wrap gap-1.5 bg-muted/40 p-1 rounded-lg border border-border/60">
          {providers.map((p) => {
            const isSelected = p.id === activeProvider;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProvider(p.id)}
                disabled={switching !== null}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-all flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                }`}
              >
                {isSelected && <CheckCircle2 className="h-3 w-3" />}
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-card/60 backdrop-blur-sm p-5 space-y-4 shadow-sm">
      {showTitle && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-3.5">
          <div>
            <div className="flex items-center gap-2 font-semibold text-base text-foreground">
              <Globe className="h-4 w-4 text-primary" /> Magic Wildcard DNS Provider
              <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-mono font-medium">
                Active: {activeProvider}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select your preferred wildcard DNS service for instant, zero-config local domain resolution.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
              <ShieldCheck className="h-3 w-3" /> Zero Configuration
            </span>
          </div>
        </div>
      )}

      {/* Provider selection cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {providers.map((p) => {
          const isSelected = p.id === activeProvider;
          const isCurrentSwitching = switching === p.id;
          const sampleHost = formatMagicDnsUrl(sampleProjectName, p.id, projectPort);

          return (
            <div
              key={p.id}
              onClick={() => handleSelectProvider(p.id)}
              className={`group relative rounded-lg border p-3.5 cursor-pointer transition-all duration-200 ${
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30"
                  : "border-border hover:border-primary/50 hover:bg-accent/40 bg-card"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40 group-hover:border-primary"
                    }`}
                  >
                    {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </div>
                  <span className="font-mono font-bold text-sm text-foreground">{p.label}</span>
                </div>
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                    isSelected
                      ? "bg-primary/10 text-primary border-primary/20 font-semibold"
                      : "bg-muted text-muted-foreground border-border/50"
                  }`}
                >
                  {p.badge}
                </span>
              </div>

              <p className="mt-2 text-xs text-muted-foreground leading-relaxed min-h-[32px]">
                {p.description}
              </p>

              <div className="mt-2.5 pt-2 border-t border-border/40">
                <span className="text-[10px] font-mono text-muted-foreground/80 block truncate">
                  Preview: <code className="text-foreground/90 font-medium">{sampleHost}</code>
                </span>
              </div>

              {isCurrentSwitching && (
                <div className="absolute inset-0 rounded-lg bg-background/60 backdrop-blur-[1px] flex items-center justify-center">
                  <span className="text-xs font-medium text-primary flex items-center gap-1.5 animate-pulse">
                    <Sparkles className="h-3.5 w-3.5 animate-spin" /> Switching...
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Live active project endpoint quick actions */}
      <div className="rounded-lg border border-border/80 bg-background/80 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            {projectName ? `Live Endpoint for "${projectName}"` : "Active Wildcard Preview"}
          </div>
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
            <span className="text-primary font-medium">{currentDirectUrl}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => copyToClipboard(currentDirectUrl)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground hover:bg-accent transition-colors"
          >
            <Copy className="h-3 w-3 text-muted-foreground" />
            {copiedUrl === currentDirectUrl ? "Copied!" : "Copy Direct URL"}
          </button>

          <a
            href={currentDirectUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Open App <ExternalLink className="h-3 w-3" />
          </a>

          <a
            href={currentProxyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground hover:bg-accent transition-colors"
            title="Routes through HosteraX Engine Reverse Proxy on :7777"
          >
            Proxy (:7777) <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
        </div>
      </div>
    </div>
  );
}
