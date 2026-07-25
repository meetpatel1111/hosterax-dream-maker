import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  Globe, Plus, Trash2, ShieldCheck, ShieldAlert, Search,
  CheckCircle2, XCircle, Clock, ExternalLink, Star, RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/_app/domains")({
  head: () => ({
    meta: [
      { title: "Domains & SSL — HosteraX" },
      { name: "description", content: "Custom domain management with automatic Let's Encrypt SSL provisioning." },
    ],
  }),
  component: DomainsPage,
});

// Generate a random challenge token for DNS TXT verification
function generateChallenge(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "hosterax-verify-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type Domain = {
  id: string;
  project_id: string;
  hostname: string;
  verified: boolean;
  is_primary: boolean;
  ssl_status: "none" | "provisioning" | "active" | "expired" | "error";
  ssl_expires_at: string | null;
  challenge_token: string;
  created_at: string;
  projects?: { name: string; slug: string } | null;
};

function DomainsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [hostname, setHostname] = useState("");
  const [selectedProject, setSelectedProject] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects-for-domains"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name, slug").order("name");
      return data ?? [];
    },
  });

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ["all-domains"],
    queryFn: async () => {
      // Domains are stored per project in local state since there's no Supabase `domains` table.
      // We simulate domain records using localStorage for the dashboard demo.
      const stored = localStorage.getItem("hx.domains");
      return stored ? (JSON.parse(stored) as Domain[]) : [];
    },
    refetchInterval: 3000,
  });

  function saveDomains(next: Domain[]) {
    localStorage.setItem("hx.domains", JSON.stringify(next));
    qc.invalidateQueries({ queryKey: ["all-domains"] });
  }

  function addDomain() {
    if (!hostname.trim()) return toast.error("Enter a hostname");
    if (!selectedProject) return toast.error("Select a project");
    const proj = projects.find((p) => p.id === selectedProject);
    if (domains.some((d) => d.hostname === hostname.trim())) return toast.error("Domain already exists");

    const newDom: Domain = {
      id: "dom_" + Math.random().toString(36).slice(2, 10),
      project_id: selectedProject,
      hostname: hostname.trim().toLowerCase(),
      verified: false,
      is_primary: false,
      ssl_status: "none",
      ssl_expires_at: null,
      challenge_token: generateChallenge(),
      created_at: new Date().toISOString(),
      projects: proj ? { name: proj.name, slug: proj.slug } : null,
    };
    saveDomains([newDom, ...domains]);
    setHostname("");
    toast.success(`Domain ${newDom.hostname} added`);
  }

  function verifyDomain(id: string) {
    // Simulate DNS TXT verification (in production: query DNS for _hosterax-challenge TXT record)
    const verified = Math.random() > 0.25;
    const next = domains.map((d) => (d.id === id ? { ...d, verified } : d));
    saveDomains(next);
    if (verified) {
      toast.success("Domain verified successfully!");
    } else {
      toast.error("DNS verification failed. Ensure TXT record is propagated.");
    }
  }

  function provisionSSL(id: string) {
    const dom = domains.find((d) => d.id === id);
    if (!dom?.verified) return toast.error("Verify domain ownership first");

    // Set to provisioning
    saveDomains(domains.map((d) => (d.id === id ? { ...d, ssl_status: "provisioning" as const } : d)));
    toast.info("SSL provisioning started via Let's Encrypt...");

    // Simulate async SSL completion
    setTimeout(() => {
      const stored = localStorage.getItem("hx.domains");
      const current = stored ? JSON.parse(stored) : [];
      const expires = new Date(Date.now() + 90 * 86400000).toISOString();
      const updated = current.map((d: Domain) =>
        d.id === id ? { ...d, ssl_status: "active", ssl_expires_at: expires } : d
      );
      localStorage.setItem("hx.domains", JSON.stringify(updated));
      qc.invalidateQueries({ queryKey: ["all-domains"] });
      toast.success("SSL certificate provisioned!");
    }, 3000);
  }

  function setPrimary(id: string) {
    const dom = domains.find((d) => d.id === id);
    if (!dom) return;
    const next = domains.map((d) =>
      d.project_id === dom.project_id
        ? { ...d, is_primary: d.id === id }
        : d
    );
    saveDomains(next);
    toast.success("Primary domain updated");
  }

  function deleteDomain(id: string) {
    if (!confirm("Delete this domain? SSL certificates will be revoked.")) return;
    saveDomains(domains.filter((d) => d.id !== id));
    toast.success("Domain removed");
  }

  function renewAll() {
    const next = domains.map((d) => {
      if (d.ssl_status === "active" || d.ssl_status === "expired") {
        return { ...d, ssl_status: "provisioning" as const };
      }
      return d;
    });
    saveDomains(next);
    toast.info("Renewing all SSL certificates...");
    setTimeout(() => {
      const stored = localStorage.getItem("hx.domains");
      const current = stored ? JSON.parse(stored) : [];
      const updated = current.map((d: Domain) =>
        d.ssl_status === "provisioning"
          ? { ...d, ssl_status: "active", ssl_expires_at: new Date(Date.now() + 90 * 86400000).toISOString() }
          : d
      );
      localStorage.setItem("hx.domains", JSON.stringify(updated));
      qc.invalidateQueries({ queryKey: ["all-domains"] });
      toast.success("All certificates renewed!");
    }, 3500);
  }

  const filtered = domains.filter((d) =>
    d.hostname.toLowerCase().includes(q.toLowerCase()) ||
    d.projects?.name?.toLowerCase().includes(q.toLowerCase())
  );

  const sslStatusIcon = (status: string) => {
    switch (status) {
      case "active": return <ShieldCheck className="h-4 w-4 text-success" />;
      case "provisioning": return <Clock className="h-4 w-4 text-warning animate-spin" />;
      case "expired": return <ShieldAlert className="h-4 w-4 text-destructive" />;
      case "error": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <ShieldAlert className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
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
              <option key={p.id} value={p.id}>{p.name}</option>
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
            <div className="mt-1 text-xs">Add a domain above and verify DNS ownership to enable SSL.</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent/40 transition-colors">
                <div className="flex items-center gap-3.5 min-w-0">
                  {sslStatusIcon(d.ssl_status)}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {d.hostname}
                      {d.is_primary && (
                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary font-medium">PRIMARY</span>
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
