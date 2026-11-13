import { useEffect, useRef, useState } from "react";
import { useEngine, useEngineHealth } from "@/lib/engine";
import { toast } from "sonner";
import { Server, Terminal, ChevronDown, ShieldCheck } from "lucide-react";

export { useEngineHealth, useEngineProjects, useEngineSystem } from "@/lib/engine";

export function EngineBar() {
  const eng = useEngine();
  const { data: health } = useEngineHealth();
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState(eng.url);
  const [tokenInput, setTokenInput] = useState(eng.token);

  useEffect(() => {
    setUrlInput(eng.url);
    setTokenInput(eng.token);
  }, [eng.url, eng.token]);

  const online = !!health?.ok;

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Server className="h-4 w-4 shrink-0 text-primary" />
          <span className="whitespace-nowrap text-sm font-semibold">Local engine</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{eng.url}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {online && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
              <ShieldCheck className="h-3 w-3 text-primary" />
              Self-Healing Watchdog: Active
            </span>
          )}
          <span className={`whitespace-nowrap text-xs ${online ? "text-success" : "text-destructive"}`}>
            {online ? `online · v${health.version}` : "offline"}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-5">
          <p className="text-xs text-muted-foreground">
            Start the runtime with{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">
              cd hosterax/engine && npm start
            </code>{" "}
            then paste the bootstrap token it prints.
          </p>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:7777"
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            />
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="hxt_..."
              type="password"
              className="rounded-md border border-input bg-input/40 px-3 py-2 font-mono text-xs"
            />
            <button
              onClick={() => {
                eng.save(urlInput.replace(/\/$/, ""), tokenInput);
                toast.success("Engine connection saved");
              }}
              className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EngineLogStream({
  deploymentId,
  onClose,
}: {
  deploymentId: string;
  onClose: () => void;
}) {
  const eng = useEngine();
  const [logs, setLogs] = useState<Array<{ stream: string; text: string }>>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const pendingLogsRef = useRef<Array<{ stream: string; text: string }>>([]);
  const renderFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setLogs([]);
    pendingLogsRef.current = [];
    renderFrameRef.current = null;
    const wsUrl = eng.url.replace(/^http/, "ws") + "/ws?deployment=" + deploymentId;
    let ws: WebSocket;
    try {
      // Browser WebSockets do not allow Authorization headers. The engine accepts the token as a
      // subprotocol instead, keeping credentials out of copied URLs and access logs.
      ws = new WebSocket(wsUrl, eng.token ? ["hosterax", eng.token] : ["hosterax"]);
    } catch {
      return;
    }
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        pendingLogsRef.current.push({ stream: m.stream, text: m.text });
        if (renderFrameRef.current !== null) return;
        renderFrameRef.current = requestAnimationFrame(() => {
          renderFrameRef.current = null;
          const pending = pendingLogsRef.current.splice(0);
          if (pending.length) setLogs((prev) => [...prev, ...pending].slice(-1000));
        });
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
      renderFrameRef.current = null;
      pendingLogsRef.current = [];
    };
  }, [deploymentId, eng.url, eng.token]);

  useEffect(() => {
    const panel = logRef.current;
    if (panel) panel.scrollTo({ top: panel.scrollHeight, behavior: "auto" });
  }, [logs]);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Terminal className="h-3.5 w-3.5 text-primary" /> Live logs · {deploymentId.slice(0, 12)}
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          close
        </button>
      </div>
      <div
        ref={logRef}
        className="max-h-[400px] overflow-y-auto bg-black/40 p-3 font-mono text-[11px]"
      >
        {logs.length === 0 && <div className="text-muted-foreground">waiting for output…</div>}
        {logs.map((l, i) => (
          <div
            key={i}
            className={
              l.stream === "stderr"
                ? "text-destructive"
                : l.stream === "system"
                  ? "text-primary"
                  : "text-foreground"
            }
          >
            <span className="text-muted-foreground/60">[{l.stream}]</span> {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
