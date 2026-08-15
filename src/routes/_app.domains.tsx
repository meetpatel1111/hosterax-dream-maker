import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { MagicDnsSelector } from "@/components/hx/magic-dns-selector";

export const Route = createFileRoute("/_app/domains")({
  head: () => ({
    meta: [
      { title: "Domains & SSL — HosteraX" },
      {
        name: "description",
        content: "Custom domain management with automatic Let's Encrypt SSL provisioning.",
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
  ssl_expires?: string | null;
  ssl_expires_at?: string | null;
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
        return data.map((d) => ({
          ...d,
          verified: !!d.verified,
          is_primary: !!d.is_primary,
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
      toast.success(`Domain ${res?.hostname || hostname.trim()} saved to database`);
      setHostname("");
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to add domain");
    }
  }

  async function verifyDomain(id: string) {
    try {
      const res = await engine.call<any>("POST", `/api/domains/${id}/verify`);
      if (res?.verified) {
        toast.success("Domain verified successfully in SQLite database!");
      } else {
        toast.error("DNS verification failed. Ensure TXT record is propagated.");
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
      toast.info("SSL provisioning started via Let's Encrypt...");
      await engine.call("POST", `/api/domains/${id}/ssl`);
      qc.invalidateQueries({ queryKey: ["all-domains"] });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["all-domains"] });
        toast.success("SSL certificate active in database!");
      }, 2500);
    } catch (err: any) {
      toast.error(err.message || "SSL provisioning failed");
    }
  }

  async function setPrimary(id: string) {
    try {
      await engine.call("POST", `/api/domains/${id}/primary`);
      toast.success("Primary domain updated in database");
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to set primary domain");
    }
  }

  async function deleteDomain(id: string) {
    if (!confirm("Delete this domain? SSL certificates will be revoked.")) return;
    try {
      await engine.call("DELETE", `/api/domains/${id}`);
      toast.success("Domain removed from database");
      qc.invalidateQueries({ queryKey: ["all-domains"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete domain");
    }
  }

  async function renewAll() {
    toast.info("Renewing all active/expired SSL certificates in database...");
    for (const d of domains) {
      if (d.ssl_status === "active" || d.ssl_status === "expired") {
        try {
          await engine.call("POST", `/api/domains/${d.id}/ssl`);
        } catch {}
      }
    }
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["all-domains"] });
      toast.success("All certificates renewed in database!");
    }, 2500);
  }

  const filtered = domains.filter(
    (d) =>
      d.hostname.toLowerCase().includes(q.toLowerCase()) ||
      d.projects?.name?.toLowerCase().includes(q.toLowerCase()),
  );

  const sslStatusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <ShieldCheck className="h-4 w-4 text-success" />;
      case "provisioning":
        return <Clock className="h-4 w-4 text-warning animate-spin" />;
      case "expired":
        return <ShieldAlert className="h-4 w-4 text-destructive" />;
      case "error":
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <ShieldAlert className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Domains & SSL</h1>
          <p className="text-sm text-muted-foreground">
            Custom domain management with automatic Let's Encrypt SSL provisioning.
          </p>
        </div>
        <button
          onClick={renewAll}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Renew All Certificates
        </button>
      </div>

      {/* Magic Wildcard DNS Provider Selection */}
      <MagicDnsSelector />

      {/* Add Domain Form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4 text-primary" /> Add custom domain
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="example.com"
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            onClick={addDomain}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search domains or projects..."
          className="w-full rounded-md border border-input bg-input/40 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>

      {/* Domains Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary mb-3">
              <Globe className="h-5 w-5" />
            </div>
            {q ? "No domains match your search." : "No custom domains configured yet."}
            <div className="mt-1 text-xs">
              Add a domain above and verify DNS ownership to enable SSL.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent/40 transition-colors"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  {sslStatusIcon(d.ssl_status)}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {d.hostname}
                      {d.is_primary && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary font-medium">
                          PRIMARY
                        </span>
                      )}
                      <a
                        href={`https://${d.hostname}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-primary"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {d.projects && (
                        <Link
                          to="/p/$slug"
                          params={{ slug: d.projects.slug }}
                          className="text-primary/80 hover:text-primary"
                        >
                          {d.projects.name}
                        </Link>
                      )}
                      <span>·</span>
                      {d.verified ? (
                        <span className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="h-3 w-3" /> Verified
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <XCircle className="h-3 w-3" /> Pending verification
                        </span>
                      )}
                      <span>·</span>
                      <span className="uppercase text-[10px]">ssl: {d.ssl_status}</span>
                      {d.ssl_expires_at && (
                        <>
                          <span>·</span>
                          <span>expires {formatDistanceToNow(new Date(d.ssl_expires_at))}</span>
                        </>
                      )}
                    </div>
                    {!d.verified && (
                      <div className="mt-1 rounded bg-surface-2 px-2 py-1 text-[10px] font-mono text-muted-foreground">
                        TXT _hosterax-challenge.{d.hostname} → {d.challenge_token}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {!d.verified && (
                    <button
                      onClick={() => verifyDomain(d.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary/60 hover:text-primary transition-colors"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Verify DNS
                    </button>
                  )}
                  {d.verified && d.ssl_status === "none" && (
                    <button
                      onClick={() => provisionSSL(d.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary/60 hover:text-primary transition-colors"
                    >
                      <ShieldCheck className="h-3 w-3" /> Provision SSL
                    </button>
                  )}
                  {d.verified && (d.ssl_status === "active" || d.ssl_status === "expired") && (
                    <button
                      onClick={() => provisionSSL(d.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-primary/60 hover:text-primary transition-colors"
                    >
                      <RefreshCw className="h-3 w-3" /> Renew
                    </button>
                  )}
                  {!d.is_primary && (
                    <button
                      onClick={() => setPrimary(d.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:border-warning/60 hover:text-warning transition-colors"
                    >
                      <Star className="h-3 w-3" /> Primary
                    </button>
                  )}
                  <button
                    onClick={() => deleteDomain(d.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-destructive/60 hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
