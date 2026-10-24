import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Play,
  RefreshCw,
  Share2,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEngine, useEngineProjects } from "@/lib/engine";

export const Route = createFileRoute("/_app/expose")({
  head: () => ({
    meta: [
      { title: "Public access — HosteraX" },
      {
        name: "description",
        content: "Give apps a public address from any computer, with free tunnels.",
      },
    ],
  }),
  component: ExposePage,
});

type Provider = {
  id: string;
  label: string;
  kind: "http" | "tcp";
  needsAccount: boolean;
  summary: string;
  limits: string;
  targetOnly: string | null;
  options: { key: string; label: string; secret: boolean; required: boolean }[];
  inAuto: boolean;
  ready: boolean;
  runsWith: string | null;
  missing: string | null;
};

type Tunnel = {
  id: string;
  target: string;
  provider: string;
  providerUsed: string | null;
  runsWith: string | null;
  kind: "http" | "tcp";
  desired: "running" | "stopped";
  status: "starting" | "running" | "waiting" | "restarting" | "failed" | "stopped";
  publicUrl: string | null;
  reachable: boolean | null;
  checkStatus: number | null;
  lastError: string | null;
  restarts: number;
  options: Record<string, string>;
  secretsSet: string[];
  attempts: string[];
};

type PublicIp = {
  ip: string | null;
  configured: string;
  configuredMatches?: boolean;
  assignedToThisMachine?: boolean;
  advice?: string;
  error?: string;
};

const inputClass =
  "rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary";

const STATUS_STYLE: Record<Tunnel["status"], string> = {
  running: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  starting: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  restarting: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  waiting: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  stopped: "border-border bg-muted/40 text-muted-foreground",
};

function ExposePage() {
  const engine = useEngine();
  const qc = useQueryClient();
  const { data: projects = [] } = useEngineProjects();

  const { data: providers = [], error } = useQuery({
    queryKey: ["tunnel-providers", engine.url, engine.token],
    queryFn: () => engine.call<Provider[]>("GET", "/api/tunnels/providers"),
    retry: false,
  });
  const { data: tunnels = [] } = useQuery({
    queryKey: ["tunnels", engine.url, engine.token],
    queryFn: () => engine.call<Tunnel[]>("GET", "/api/tunnels"),
    enabled: !error,
    refetchInterval: 3000,
  });
  const autoKey = ["tunnel-auto", engine.url, engine.token];
  const { data: auto } = useQuery({
    queryKey: autoKey,
    queryFn: () => engine.call<{ enabled: boolean; provider: string }>("GET", "/api/expose/auto"),
    enabled: !error,
  });

  const [target, setTarget] = useState("");
  const [providerId, setProviderId] = useState("auto");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<Record<string, string[] | undefined>>({});
  const [ip, setIp] = useState<PublicIp | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tunnels"] });
    qc.invalidateQueries({ queryKey: ["tunnel-auto"] });
  };
  async function act<T>(fn: () => Promise<T>, ok?: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      refresh();
      return r;
    } catch (e: any) {
      toast.error(e?.message || "That did not work");
    } finally {
      setBusy(false);
    }
  }

  // the control answers at once; the server's reply replaces it, or undoes it if the change is refused
  async function setAuto(patch: { enabled?: boolean; provider?: string }, ok?: string) {
    const previous = qc.getQueryData<{ enabled: boolean; provider: string }>(autoKey);
    qc.setQueryData(autoKey, { enabled: false, provider: "auto", ...previous, ...patch });
    const r = await act(() => engine.call("PUT", "/api/expose/auto", patch), ok);
    if (r === undefined) qc.setQueryData(autoKey, previous);
  }

  if (error) {
    const forbidden = /scope|forbidden|403/i.test((error as Error).message);
    return (
      <div className="mx-auto max-w-3xl rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {forbidden
          ? "Managing public access needs an admin: sign in with an admin account or token."
          : (error as Error).message}
      </div>
    );
  }

  const provider = providers.find((p) => p.id === providerId);
  const targets = [
    ...projects.map((p: any) => ({ value: String(p.name), label: String(p.name) })),
    { value: "edge", label: "edge — the HosteraX proxy (all apps by hostname)" },
  ];
  const effectiveTarget = provider?.targetOnly || target || targets[0]?.value || "";
  // the same rule the engine applies: nothing to fill in, and not the custom command
  const autoProviders = providers.filter(
    (p) => p.id !== "custom" && !p.targetOnly && !p.options.some((o) => o.required),
  );
  const missingRequired = (provider?.options ?? []).filter((o) => o.required && !values[o.key]);
  const canCreate =
    !!effectiveTarget &&
    (providerId === "auto" || provider?.ready) &&
    missingRequired.length === 0 &&
    !busy;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Share2 className="h-6 w-6 text-primary" /> Public access
        </h1>
        <p className="text-sm text-muted-foreground">
          Give an app an address anyone on the internet can open, from any computer: no public IP,
          no router settings, works behind home internet and company networks. The services below
          are free.
        </p>
      </div>

      <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <p>
          <strong>Anyone with the address can open the app.</strong> It is exposed as it is, so make
          sure it has its own login. The HosteraX dashboard and engine API are never made public
          this way. Free relays are run by other companies: they see the traffic that is not
          end-to-end encrypted by your app, and may change or end their free offer.
        </p>
      </div>

      {/* make an app public */}
      <form
        className="space-y-4 rounded-lg border border-border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const options = Object.fromEntries(
              Object.entries(values).filter(
                ([k, v]) => v && provider?.options.some((o) => o.key === k),
              ),
            );
            await engine.call("POST", "/api/tunnels", {
              target: effectiveTarget,
              provider: providerId,
              options,
            });
            setValues({});
          }, "Starting. The address appears below in a few seconds.");
        }}
      >
        <div className="text-sm font-medium">Make an app public</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            App
            <select
              className={`${inputClass} w-full text-foreground`}
              value={provider?.targetOnly ? provider.targetOnly : effectiveTarget}
              disabled={!!provider?.targetOnly}
              onChange={(e) => setTarget(e.target.value)}
            >
              {targets.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            How
            <select
              className={`${inputClass} w-full text-foreground`}
              value={providerId}
              onChange={(e) => {
                setProviderId(e.target.value);
                setValues({});
              }}
            >
              <option value="auto">Automatic — the first free option that works here</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.needsAccount ? " (free account)" : ""}
                  {p.ready ? "" : " — not set up on this machine"}
                </option>
              ))}
            </select>
          </label>
        </div>

        {providerId === "auto" ? (
          <p className="text-xs text-muted-foreground">
            Tries{" "}
            {providers
              .filter((p) => p.inAuto)
              .map((p) => p.label)
              .join(", then ")}
            , and uses the first one that connects. Needs nothing but one of cloudflared, Docker or
            ssh on this machine.
          </p>
        ) : (
          provider && (
            <div className="space-y-2 rounded-md border border-border p-3 text-xs">
              <p>{provider.summary}</p>
              <p className="text-muted-foreground">{provider.limits}</p>
              {!provider.ready && (
                <p className="text-amber-400">This machine can't run it yet: {provider.missing}.</p>
              )}
              {provider.ready && provider.runsWith && (
                <p className="text-emerald-400">Ready — runs with {provider.runsWith}.</p>
              )}
              {provider.options.length > 0 && (
                <div className="grid gap-2 pt-1 sm:grid-cols-2">
                  {provider.options.map((o) => (
                    <label key={o.key} className="space-y-1 text-muted-foreground">
                      {o.label}
                      {o.required ? " *" : ""}
                      <input
                        type={o.secret ? "password" : "text"}
                        autoComplete="off"
                        className={`${inputClass} w-full text-foreground`}
                        value={values[o.key] ?? ""}
                        onChange={(e) => setValues({ ...values, [o.key]: e.target.value })}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        )}

        <button
          disabled={!canCreate}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Make public
        </button>
      </form>

      {/* addresses */}
      <div className="space-y-3">
        <div className="text-sm font-medium">Public addresses</div>
        {tunnels.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing is public yet.
          </div>
        )}
        {tunnels.map((t) => (
          <div key={t.id} className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {t.target === "edge" ? "HosteraX edge" : t.target}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_STYLE[t.status]}`}
              >
                {t.status}
              </span>
              <span className="text-xs text-muted-foreground">
                via{" "}
                {providers.find((p) => p.id === (t.providerUsed || t.provider))?.label ??
                  t.provider}
                {t.runsWith ? ` · ${t.runsWith}` : ""}
                {t.restarts ? ` · ${t.restarts} reconnect${t.restarts === 1 ? "" : "s"}` : ""}
              </span>
              <div className="ml-auto flex gap-1">
                {t.desired === "running" ? (
                  <button
                    title="Stop making it public"
                    disabled={busy}
                    onClick={() =>
                      act(() => engine.call("POST", `/api/tunnels/${t.id}/stop`), "Stopped")
                    }
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    <Square className="h-3 w-3" />
                  </button>
                ) : (
                  <button
                    title="Start"
                    disabled={busy}
                    onClick={() =>
                      act(() => engine.call("POST", `/api/tunnels/${t.id}/start`), "Starting")
                    }
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                )}
                <button
                  title="Reconnect (the address may change)"
                  disabled={busy}
                  onClick={() =>
                    act(() => engine.call("POST", `/api/tunnels/${t.id}/restart`), "Reconnecting")
                  }
                  className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
                <button
                  title="Remove"
                  disabled={busy}
                  onClick={() =>
                    act(() => engine.call("DELETE", `/api/tunnels/${t.id}`), "Removed")
                  }
                  className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>

            {t.status === "running" && (
              <div className="flex flex-wrap items-center gap-2">
                {t.publicUrl ? (
                  <code className="break-all rounded bg-muted px-2 py-1 font-mono text-sm select-all">
                    {t.publicUrl}
                  </code>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Connected. The address is the hostname you set in your Cloudflare dashboard.
                  </span>
                )}
                {t.publicUrl && (
                  <button
                    title="Copy"
                    onClick={() => {
                      navigator.clipboard.writeText(t.publicUrl!);
                      toast.success("Copied");
                    }}
                    className="rounded border border-border px-2 py-1 hover:bg-accent"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                )}
                {t.publicUrl && t.kind === "http" && (
                  <a
                    href={t.publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open"
                    className="rounded border border-border px-2 py-1 hover:bg-accent"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {t.reachable !== null && (
                  <span className="text-xs text-muted-foreground">
                    {t.reachable
                      ? `answers (HTTP ${t.checkStatus})${t.checkStatus && t.checkStatus >= 500 ? " — is the app running?" : ""}`
                      : "did not answer from this machine"}
                  </span>
                )}
              </div>
            )}

            {t.lastError && t.status !== "running" && (
              <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                {t.lastError}
              </pre>
            )}

            <div>
              <button
                className="text-xs text-primary underline"
                onClick={async () => {
                  if (logs[t.id]) return setLogs({ ...logs, [t.id]: undefined });
                  const r = await engine
                    .call<{ lines: string[] }>("GET", `/api/tunnels/${t.id}/logs`)
                    .catch(() => ({ lines: ["(could not read the log)"] }));
                  setLogs({ ...logs, [t.id]: r.lines });
                }}
              >
                {logs[t.id] ? "Hide log" : "Show log"}
              </button>
              {logs[t.id] && (
                <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-[11px]">
                  {logs[t.id]!.join("\n") || "(no output yet)"}
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* automatic */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wand2 className="h-4 w-4 text-primary" /> Automatic
        </div>
        <p className="text-xs text-muted-foreground">
          Give every deployed project a public address on its own, now and for new deployments, and
          keep them connected across restarts. Off by default: it makes <strong>every</strong> app
          public. Switching one off in the list above sticks.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={auto?.enabled ?? false}
              disabled={busy}
              onChange={(e) =>
                setAuto(
                  { enabled: e.target.checked },
                  e.target.checked
                    ? "Every deployed project will be made public"
                    : "Automatic exposure is off",
                )
              }
            />
            Expose every deployed project
          </label>
          <select
            className={`${inputClass} text-foreground`}
            value={auto?.provider ?? "auto"}
            disabled={busy}
            onChange={(e) => setAuto({ provider: e.target.value })}
          >
            <option value="auto">Automatic choice</option>
            {autoProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* public address of this machine */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div className="text-sm font-medium">This machine's public address</div>
        <p className="text-xs text-muted-foreground">
          Only needed for Magic DNS names (such as app.203-0-113-9.sslip.io) or if you open ports on
          your router. Tunnels above don't need it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                setIp(await engine.call<PublicIp>("GET", "/api/expose/public-ip"));
              })
            }
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Check
          </button>
          {ip?.ip && (
            <>
              <code className="rounded bg-muted px-2 py-1 font-mono text-sm">{ip.ip}</code>
              {!ip.configuredMatches && (
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await engine.call("POST", "/api/expose/public-ip", { ip: ip.ip });
                      setIp(await engine.call<PublicIp>("GET", "/api/expose/public-ip"));
                    }, "Saved. Magic DNS names now use it.")
                  }
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Use it for Magic DNS
                </button>
              )}
            </>
          )}
        </div>
        {ip && <p className="text-xs">{ip.error ?? ip.advice}</p>}
        {ip?.ip && (
          <p className="text-[11px] text-muted-foreground">
            HosteraX is currently using <span className="font-mono">{ip.configured}</span>.
          </p>
        )}
      </div>
    </div>
  );
}
