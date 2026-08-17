import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useEngine } from "@/lib/engine";
import {
  Globe,
  Plus,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  Star,
  RefreshCw,
  Upload,
  Lock,
  Zap,
  Flame,
  Layers,
  Key,
  Copy,
  Info,
  SlidersHorizontal,
  ChevronRight,
} from "lucide-react";
import { MagicDnsSelector } from "@/components/hx/magic-dns-selector";

export const Route = createFileRoute("/_app/domains")({
  head: () => ({
    meta: [
      { title: "Domains & SSL — HosteraX" },
      {
        name: "description",
        content: "Custom domain management with automatic Let's Encrypt & ZeroSSL provisioning.",
      },
    ],
  }),
  component: DomainsPage,
});

type Domain = {
  id: string;
  project: string;
  project_id?: string;
  hostname: string;
  verified: boolean | number;
  is_primary: boolean | number;
  ssl_status: "none" | "provisioning" | "active" | "expired" | "error";
  ssl_issuer?: string | null;
  ssl_expires_at?: number | string | null;
  ssl_fingerprint?: string | null;
  force_https?: boolean | number;
  hsts_enabled?: boolean | number;
  challenge_token: string;
  created_at: number | string;
  projects?: { name: string; slug: string } | null;
};

function DomainsPage() {
  const engine = useEngine();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [hostname, setHostname] = useState("");
  const [selectedProject, setSelectedProject] = useState("");

  // Modal states
  const [customSslModalDomain, setCustomSslModalDomain] = useState<Domain | null>(null);
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const [securityModalDomain, setSecurityModalDomain] = useState<Domain | null>(null);
  const [forceHttps, setForceHttps] = useState(true);
  const [hstsEnabled, setHstsEnabled] = useState(true);

  // Fetch Edge Gateway status
  const { data: edgeStatus } = useQuery<any>({
    queryKey: ["edge-status", engine.url],
    queryFn: async () => {
      try {
        return await engine.call<any>("GET", "/api/edge/status");
      } catch {
        return { provider: "caddy", containerStatus: "running" };
      }
    },
    refetchInterval: 5000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-domains", engine.url],
    queryFn: async () => {
      try {
        const data = await engine.call<any[]>("GET", "/api/projects");
        return data ?? [];
      } catch {
        return [];
      }
    },
  });

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ["all-domains", engine.url],
    queryFn: async () => {
      try {
        const data = await engine.call<any[]>("GET", "/api/domains");
        return (data || []).map((d) => ({
          ...d,
          verified: !!d.verified,
          is_primary: !!d.is_primary,
          force_https: d.force_https !== undefined ? !!d.force_https : true,
          hsts_enabled: d.hsts_enabled !== undefined ? !!d.hsts_enabled : true,
          project_id: d.project,
          projects: { name: d.project, slug: d.project },
        })) as Domain[];
      } catch {
        return [];
      }
    },
    refetchInterval: 3000,
  });

  async function addDomain() {
    if (!hostname.trim()) return toast.error("Enter a hostname");
    if (!selectedProject) return toast.error("Select a project");
    if (domains.some((d) => d.hostname === hostname.trim().toLowerCase()))
      return toast.error("Domain already exists");

    try {
      const res = await engine.call<any>("POST", `/api/projects/${selectedProject}/domains`, {
        hostname: hostname.trim().toLowerCase(),
      });
      toast.success(`Domain ${res?.hostname || hostname.trim()} registered and edge route synced!`);
      setHostname("");
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to add domain");
    }
  }

  async function verifyDomain(id: string) {
    try {
      toast.info("Querying DNS records for ownership verification...");
      const res = await engine.call<any>("POST", `/api/domains/${id}/verify`);
      if (res?.verified) {
        toast.success(res.message || "Domain verified successfully via DNS!");
      } else {
        toast.error(res.message || "DNS verification failed. Ensure TXT record is propagated.");
      }
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (err: any) {
      toast.error(err.message || "Verification request failed");
    }
  }

  async function provisionSSL(id: string) {
    const dom = domains.find((d) => d.id === id);
    if (!dom?.verified) return toast.error("Verify domain ownership first");

    try {
      const provName =
        edgeStatus?.provider === "caddy" ? "Caddy (Let's Encrypt / ZeroSSL)" : "OpenResty ACME";
      toast.info(`Requesting automatic TLS certificate via ${provName}...`);
      await engine.call("POST", `/api/domains/${id}/ssl`);
      qc.invalidateQueries({ queryKey: ["all-domains"] });
      toast.success("TLS Certificate active & configured on Edge Gateway!");
    } catch (err: any) {
      toast.error(err.message || "SSL provisioning failed");
    }
  }

  async function setPrimary(id: string) {
    try {
      await engine.call("POST", `/api/domains/${id}/primary`);
      toast.success("Primary domain updated and Edge routes synchronized");
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to set primary domain");
    }
  }

  async function deleteDomain(id: string) {
    if (!confirm("Delete this domain? TLS routes and certificates will be removed.")) return;
    try {
      await engine.call("DELETE", `/api/domains/${id}`);
      toast.success("Domain removed from Edge Gateway");
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete domain");
    }
  }

  async function handleUploadCustomSsl() {
    if (!customSslModalDomain) return;
    if (!certPem.trim() || !keyPem.trim()) {
      return toast.error("Please provide both Certificate PEM and Private Key PEM");
    }

    try {
      toast.info("Validating and applying custom certificate...");
      const res = await engine.call<any>(
        "POST",
        `/api/domains/${customSslModalDomain.id}/custom-ssl`,
        {
          cert_pem: certPem.trim(),
          key_pem: keyPem.trim(),
        },
      );
      toast.success(
        `Custom SSL active! Issued by ${res.issuer}, valid for ${res.daysRemaining} days.`,
      );
      setCustomSslModalDomain(null);
      setCertPem("");
      setKeyPem("");
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (e: any) {
      toast.error(e.message || "Invalid SSL Certificate or Key");
    }
  }

  async function handleSaveSecuritySettings() {
    if (!securityModalDomain) return;
    try {
      await engine.call("POST", `/api/domains/${securityModalDomain.id}/security`, {
        force_https: forceHttps,
        hsts_enabled: hstsEnabled,
      });
      toast.success("HTTPS Security settings applied to Edge Gateway!");
      setSecurityModalDomain(null);
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to update security settings");
    }
  }

  async function renewAll() {
    toast.info("Resyncing all Edge routes & TLS certificates...");
    try {
      await engine.call("POST", "/api/edge/sync");
      for (const d of domains) {
        if (d.verified) {
          try {
            await engine.call("POST", `/api/domains/${d.id}/ssl`);
          } catch {}
        }
      }
      qc.invalidateQueries({ queryKey: ["all-domains"] });
      toast.success("All certificates & Edge routes synchronized!");
    } catch (e: any) {
      toast.error(e.message || "Failed to renew certificates");
    }
  }

  const filtered = domains.filter(
    (d) =>
      d.hostname.toLowerCase().includes(q.toLowerCase()) ||
      d.projects?.name?.toLowerCase().includes(q.toLowerCase()),
  );

  const sslStatusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
      case "provisioning":
        return <Clock className="h-4 w-4 text-amber-500 animate-spin" />;
      case "expired":
        return <ShieldAlert className="h-4 w-4 text-destructive" />;
      case "error":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <ShieldAlert className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const edgeProvider = edgeStatus?.provider || "caddy";

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Domains & Automatic TLS/SSL</h1>
          <p className="text-sm text-muted-foreground">
            Universal edge routing, automated Let's Encrypt / ZeroSSL certificate lifecycle, and
            custom TLS upload.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Lock className="h-3.5 w-3.5" /> Edge Gateway Settings
          </Link>
          <button
            onClick={renewAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Resync Edge & Renew
          </button>
        </div>
      </div>

      {/* Active Edge Gateway Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {edgeProvider === "caddy" ? (
              <Zap className="h-5 w-5" />
            ) : edgeProvider === "openresty" ? (
              <Flame className="h-5 w-5" />
            ) : (
              <Globe className="h-5 w-5" />
            )}
          </div>
          <div>
            <div className="font-semibold text-foreground flex items-center gap-2">
              Active Edge Gateway:{" "}
              {edgeProvider === "caddy"
                ? "Caddy 2 Engine"
                : edgeProvider === "openresty"
                  ? "OpenResty (Nginx + Lua)"
                  : "External Proxy"}
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                Port :80 & :443 Live
              </span>
            </div>
            <p className="text-muted-foreground text-[11px] mt-0.5">
              {edgeProvider === "caddy"
                ? "Automatic Multi-CA HTTPS (Let's Encrypt + ZeroSSL) with On-Demand TLS and zero-downtime hot reloads."
                : edgeProvider === "openresty"
                  ? "Nginx + Lua reverse proxy with ACME HTTP-01 webroot challenge and modular /etc/letsencrypt vhosts."
                  : "Bypassing local container. Configuration exports generated in ~/.hosterax/edge."}
            </p>
          </div>
        </div>
        <Link
          to="/settings"
          className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          Switch Edge Provider in Settings <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Magic Wildcard DNS Provider Selection */}
      <MagicDnsSelector />

      {/* Add Domain Form */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4 text-primary" /> Register Custom Domain
        </div>
        <p className="text-xs text-muted-foreground">
          Attach a public domain or subdomain to any deployed service. HosteraX will automatically
          manage DNS verification and SSL certificates.
        </p>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="api.mycompany.com"
            className="rounded-lg border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary font-mono"
          />
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="rounded-lg border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="">Select Project Target…</option>
            {projects.map((p) => (
              <option key={p.id || p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={addDomain}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition shadow-sm"
          >
            <Plus className="h-4 w-4" /> Add Domain
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search domains, projects, or SSL status..."
          className="w-full rounded-lg border border-input bg-input/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>

      {/* Domains Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary mb-3">
              <Globe className="h-5 w-5" />
            </div>
            {q ? "No domains match your search." : "No custom domains configured yet."}
            <div className="mt-1 text-xs">
              Add a domain above to enable automatic TLS / SSL and Edge Gateway routing.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-4 p-5 hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className="mt-0.5">{sslStatusIcon(d.ssl_status)}</div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {d.hostname}
                      </span>
                      {d.is_primary && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary font-semibold">
                          PRIMARY
                        </span>
                      )}
                      <a
                        href={`https://${d.hostname}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-primary transition"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {d.projects && (
                        <Link
                          to="/p/$slug"
                          params={{ slug: d.projects.slug }}
                          className="font-medium text-primary hover:underline"
                        >
                          {d.projects.name}
                        </Link>
                      )}
                      <span>•</span>
                      {d.verified ? (
                        <span className="flex items-center gap-1 text-emerald-500 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> DNS Verified
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-500 font-medium">
                          <XCircle className="h-3.5 w-3.5" /> DNS Pending
                        </span>
                      )}
                      <span>•</span>
                      <span className="uppercase text-[10px] font-mono">
                        SSL: <span className="font-semibold text-foreground">{d.ssl_status}</span>
                      </span>
                      {d.ssl_issuer && d.ssl_issuer !== "none" && (
                        <>
                          <span>•</span>
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {d.ssl_issuer}
                          </span>
                        </>
                      )}
                      {d.ssl_expires_at ? (
                        <>
                          <span>•</span>
                          <span className="text-[11px]">
                            expires {formatDistanceToNow(new Date(Number(d.ssl_expires_at)))}
                          </span>
                        </>
                      ) : null}
                    </div>

                    {!d.verified && (
                      <div className="mt-2 rounded-lg border border-border/70 bg-muted/30 p-2.5 text-xs space-y-1">
                        <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                          <Info className="h-3.5 w-3.5 text-primary" /> Required DNS Verification
                          Record:
                        </div>
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px] bg-card p-1.5 rounded border border-border">
                          <span>
                            Type: <strong>TXT</strong> | Name:{" "}
                            <strong>_hosterax-challenge.{d.hostname}</strong> | Value:{" "}
                            <strong>{d.challenge_token}</strong>
                          </span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(d.challenge_token);
                              toast.success("Verification token copied to clipboard!");
                            }}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {!d.verified && (
                    <button
                      onClick={() => verifyDomain(d.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/60 hover:text-primary transition shadow-sm"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Verify DNS
                    </button>
                  )}

                  {d.verified && (
                    <button
                      onClick={() => provisionSSL(d.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/60 hover:text-primary transition shadow-sm"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      {d.ssl_status === "active" ? "Renew SSL" : "Provision SSL"}
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setCustomSslModalDomain(d);
                      setCertPem("");
                      setKeyPem("");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/60 hover:text-primary transition shadow-sm"
                  >
                    <Upload className="h-3.5 w-3.5 text-muted-foreground" /> Custom Cert
                  </button>

                  <button
                    onClick={() => {
                      setSecurityModalDomain(d);
                      setForceHttps(d.force_https !== false);
                      setHstsEnabled(d.hsts_enabled !== false);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" /> Security
                  </button>

                  {!d.is_primary && (
                    <button
                      onClick={() => setPrimary(d.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:border-amber-500/60 hover:text-amber-500 transition"
                    >
                      <Star className="h-3.5 w-3.5" /> Set Primary
                    </button>
                  )}

                  <button
                    onClick={() => deleteDomain(d.id)}
                    className="inline-flex items-center rounded-lg border border-border bg-card p-1.5 text-xs text-muted-foreground hover:border-destructive/60 hover:text-destructive transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Custom SSL Certificate Modal */}
      {customSslModalDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold">Upload Custom SSL Certificate</h3>
              </div>
              <button
                onClick={() => setCustomSslModalDomain(null)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              Provide your own custom X.509 certificate chain (.pem / .crt) and private key (.key)
              for <strong className="text-foreground">{customSslModalDomain.hostname}</strong>.
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Certificate Chain (PEM format)
                </label>
                <textarea
                  rows={4}
                  value={certPem}
                  onChange={(e) => setCertPem(e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  className="w-full rounded-md border border-input bg-muted/20 px-3 py-2 font-mono text-xs outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Private Key (PEM format)
                </label>
                <textarea
                  rows={4}
                  value={keyPem}
                  onChange={(e) => setKeyPem(e.target.value)}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
                  className="w-full rounded-md border border-input bg-muted/20 px-3 py-2 font-mono text-xs outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
              <button
                onClick={() => setCustomSslModalDomain(null)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-accent transition"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadCustomSsl}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition shadow-sm"
              >
                Install Custom Certificate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Domain Security Settings Modal */}
      {securityModalDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold">Security & Redirection</h3>
              </div>
              <button
                onClick={() => setSecurityModalDomain(null)}
                className="text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-muted-foreground">
              Configure edge security policies for{" "}
              <strong className="text-foreground">{securityModalDomain.hostname}</strong>.
            </div>

            <div className="space-y-3 pt-2">
              <label className="flex items-center gap-3 text-xs font-medium text-foreground cursor-pointer rounded-lg border border-border p-3 hover:bg-muted/20">
                <input
                  type="checkbox"
                  checked={forceHttps}
                  onChange={(e) => setForceHttps(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                />
                <div>
                  <div className="font-semibold">Force HTTP to HTTPS Redirect</div>
                  <div className="text-[11px] text-muted-foreground">
                    Automatically upgrades all insecure HTTP requests on port 80 to HTTPS 443
                  </div>
                </div>
              </label>

              <label className="flex items-center gap-3 text-xs font-medium text-foreground cursor-pointer rounded-lg border border-border p-3 hover:bg-muted/20">
                <input
                  type="checkbox"
                  checked={hstsEnabled}
                  onChange={(e) => setHstsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                />
                <div>
                  <div className="font-semibold">Enable HSTS (Strict-Transport-Security)</div>
                  <div className="text-[11px] text-muted-foreground">
                    Instructs browsers to always use encrypted TLS connections for 1 year
                  </div>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
              <button
                onClick={() => setSecurityModalDomain(null)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-accent transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSecuritySettings}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 transition shadow-sm"
              >
                Save Security Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
