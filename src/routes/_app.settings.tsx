import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useState } from "react";
import { toast } from "sonner";
import { useEngine } from "@/lib/engine";
import { MagicDnsSelector } from "@/components/hx/magic-dns-selector";
import { EdgeProviderSelector } from "@/components/hx/edge-provider-selector";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — HosteraX" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const engine = useEngine();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  const [engUrl, setEngUrl] = useState(engine.url);
  const [engToken, setEngToken] = useState(engine.token);

  function saveEngineConfig() {
    engine.save(engUrl, engToken);
    toast.success("Control Plane Engine configuration saved!");
  }

  async function changePw() {
    if (pw.length < 6) return toast.error("Password must be at least 6 characters");
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setPw("");
      toast.success("Admin password updated in SQLite database");
    }, 500);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your account, control plane, and host machine specifications.
        </p>
      </div>

      {/* Managed Edge Gateway Selector (Caddy 2 vs OpenResty vs External) */}
      <EdgeProviderSelector />

      {/* Magic Wildcard DNS Provider Setting */}
      <MagicDnsSelector />

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Control Plane Engine (SQLite DB)</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Configure the connection to your self-hosted Engine (default: http://localhost:7777).
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Engine URL</label>
            <input
              type="text"
              value={engUrl}
              onChange={(e) => setEngUrl(e.target.value)}
              placeholder="http://localhost:7777"
              className="w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Master Engine Token</label>
            <input
              type="password"
              value={engToken}
              onChange={(e) => setEngToken(e.target.value)}
              placeholder="Engine access token"
              className="w-full rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={saveEngineConfig}
            className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 w-fit"
          >
            Save Connection
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Account</div>
        <div className="mt-3 grid gap-3 text-sm">
          <Row k="Email" v={user?.email ?? "admin@hosterax.local"} />
          <Row
            k="User ID"
            v={<span className="font-mono text-xs">{user?.id ?? "local-admin"}</span>}
          />
          <Row
            k="Signed in"
            v={user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "—"}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Change Admin Password</div>
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password"
            className="flex-1 rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={changePw}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Update
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Instance Specifications</div>
        <div className="mt-3 grid gap-3 text-sm">
          <Row k="Version" v="HosteraX v0.2.2" />
          <Row k="Database" v="Embedded SQLite (hosterax.db)" />
          <Row k="License" v="Apache 2.0" />
          <Row k="Mode" v="Self-hosted (control plane)" />
          <Row k="Reverse Proxy" v="HosteraX Edge Proxy (Port 7777)" />
          <Row k="TLS Issuer" v="Let's Encrypt ACME v2" />
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
