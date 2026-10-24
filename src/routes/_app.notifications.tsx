import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Bell, Plus, Send, Trash2 } from "lucide-react";
import { useEngine } from "@/lib/engine";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — HosteraX" },
      {
        name: "description",
        content:
          "Get told when a deploy fails, an app crashes, a server goes away or a backup fails.",
      },
    ],
  }),
  component: Notifications,
});

type Channel = {
  id: string;
  name: string;
  type: "webhook" | "slack" | "discord" | "ntfy" | "email";
  events: string[];
  enabled: boolean;
  target: string;
  signed: boolean;
  lastStatus: string | null;
  lastError: string | null;
  lastSentAt: number | null;
};
type Listing = {
  channels: Channel[];
  events: Record<string, string>;
  types: string[];
  recent: {
    id: string;
    channelName: string | null;
    kind: string;
    title: string;
    status: string;
    error: string | null;
    createdAt: number;
  }[];
};

const TYPE_HELP: Record<string, string> = {
  slack: "A Slack incoming-webhook URL.",
  discord: "A Discord channel webhook URL.",
  ntfy: "An ntfy topic URL, e.g. https://ntfy.sh/my-topic — for push notifications on your phone.",
  webhook: "Any URL. It receives a JSON POST; set a secret to get an X-Hosterax-Signature header.",
  email: "Sent through the SMTP relay configured under Mailboxes.",
};
const QUIET = new Set(["deploy.succeeded", "server.up"]);

function Notifications() {
  const engine = useEngine();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("slack");
  const [url, setUrl] = useState("");
  const [to, setTo] = useState("");
  const [secret, setSecret] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["notifications", engine.url],
    queryFn: () => engine.call<Listing>("GET", "/api/notifications"),
    refetchInterval: 10000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  async function add() {
    if (!name.trim()) return toast.error("Give the channel a name");
    try {
      const c = await engine.call<Channel>("POST", "/api/notifications", {
        name: name.trim(),
        type,
        ...(type === "email" ? { to } : { url }),
        ...(type === "webhook" && secret ? { secret } : {}),
        events: picked,
      });
      const t = await engine.call<{ ok: boolean; error?: string }>(
        "POST",
        `/api/notifications/${c.id}/test`,
      );
      if (t.ok) toast.success("Added. A test message was delivered.");
      else toast.warning(`Added, but the test message failed: ${t.error}`);
      setName("");
      setUrl("");
      setTo("");
      setSecret("");
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Could not add the channel");
    }
  }

  async function test(c: Channel) {
    try {
      const t = await engine.call<{ ok: boolean; error?: string }>(
        "POST",
        `/api/notifications/${c.id}/test`,
      );
      if (t.ok) toast.success(`Delivered to ${c.name}`);
      else toast.error(t.error || "The message was not delivered");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function toggle(c: Channel) {
    await engine
      .call("PATCH", `/api/notifications/${c.id}`, { enabled: !c.enabled })
      .catch((e) => toast.error(e.message));
    refresh();
  }

  async function remove(c: Channel) {
    if (!confirm(`Remove "${c.name}"?`)) return;
    await engine.call("DELETE", `/api/notifications/${c.id}`).catch((e) => toast.error(e.message));
    refresh();
  }

  const events = data?.events ?? {};

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Get told when something needs you, instead of finding out later: a deploy fails, an app
          keeps crashing, a server goes away, a backup or its restore drill fails. The same problem
          is reported once per ten minutes, not on every check.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Bell className="h-4 w-4 text-primary" /> Add a channel
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Team Slack"
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm"
          >
            {(data?.types ?? ["slack", "discord", "ntfy", "webhook", "email"]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 grid gap-3">
          {type === "email" ? (
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="you@example.com, teammate@example.com"
              className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          ) : (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary"
            />
          )}
          {type === "webhook" && (
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Signing secret (optional)"
              className="rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          )}
          <p className="text-xs text-muted-foreground">{TYPE_HELP[type]}</p>
        </div>
        <fieldset className="mt-3">
          <legend className="text-xs font-medium text-muted-foreground">
            Tell me about (none ticked = everything important)
          </legend>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {Object.entries(events).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={picked.includes(k)}
                  onChange={(e) =>
                    setPicked(e.target.checked ? [...picked, k] : picked.filter((x) => x !== k))
                  }
                />
                {label}
                {QUIET.has(k) && <span className="text-muted-foreground">(only if ticked)</span>}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          onClick={add}
          className="mt-4 inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add and send a test
        </button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {error ? (
          <div className="p-8 text-center text-sm text-destructive">
            {(error as Error).message.includes("scope")
              ? "Your token is not allowed to manage notifications (admin scope required)."
              : (error as Error).message}
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !data?.channels.length ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No channels yet. Failures will only show up in the Activity page.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.channels.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {c.name}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
                      {c.type}
                    </span>
                    {!c.enabled && <span className="text-xs text-muted-foreground">(off)</span>}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {c.target} · {c.events.length ? c.events.join(", ") : "everything important"}
                  </div>
                  <div
                    className={`text-xs ${c.lastStatus === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {c.lastStatus
                      ? `Last send ${c.lastStatus}${c.lastSentAt ? ` ${formatDistanceToNow(new Date(c.lastSentAt), { addSuffix: true })}` : ""}${c.lastError ? `: ${c.lastError}` : ""}`
                      : "Nothing sent yet"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => test(c)}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    <Send className="h-3 w-3" /> Test
                  </button>
                  <button
                    onClick={() => toggle(c)}
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    {c.enabled ? "Turn off" : "Turn on"}
                  </button>
                  <button
                    onClick={() => remove(c)}
                    title="Remove"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!!data?.recent.length && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 text-sm font-medium">Recently sent</div>
          <div className="space-y-1 text-xs">
            {data.recent.slice(0, 10).map((r) => (
              <div key={r.id} className="flex flex-wrap gap-2 font-mono text-muted-foreground">
                <span>{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span>
                <span>{r.channelName ?? "removed channel"}</span>
                <span className={r.status === "failed" ? "text-destructive" : ""}>{r.status}</span>
                <span className="truncate">{r.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
