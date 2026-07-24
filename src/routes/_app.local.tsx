import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/hx/dashboard-shell";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/local")({
  head: () => ({
    meta: [
      { title: "Local engine · HosteraX" },
      { name: "description", content: "Drive the HosteraX engine running on your PC — real deploys, real logs, no cloud." },
      { property: "og:title", content: "HosteraX · local engine" },
      { property: "og:description", content: "Real deploys on your machine." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LocalEngine,
});

type Project = { name: string; source: string; build_cmd: string; start_cmd: string; env_json: string; target: string; created_at: number };
type Deploy = { id: string; project: string; version: string; phase: string; trigger: string; started_at: number; finished_at: number | null; exit_code: number | null; workdir: string };

function useEngine() {
  const [url, setUrl] = useState(() => localStorage.getItem("hx.url") || "http://localhost:7777");
  const [token, setToken] = useState(() => localStorage.getItem("hx.token") || "");
  const save = (u: string, t: string) => { localStorage.setItem("hx.url", u); localStorage.setItem("hx.token", t); setUrl(u); setToken(t); };
  const call = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(url + path, {
      method, headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };
  return { url, token, save, call };
}

function LocalEngine() {
  const eng = useEngine();
  const [status, setStatus] = useState<"unknown" | "up" | "down">("unknown");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [deploys, setDeploys] = useState<Deploy[]>([]);
  const [activeDeploy, setActiveDeploy] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // new project form
  const [np, setNp] = useState({ name: "", source: "", buildCmd: "", startCmd: "", env: "" });

  const ping = async () => {
    try { const r = await fetch(eng.url + "/health"); setStatus(r.ok ? "up" : "down"); }
    catch { setStatus("down"); }
  };
  const refreshProjects = async () => {
    try { setProjects(await eng.call<Project[]>("GET", "/api/projects")); } catch (e) { toast.error(String(e)); }
  };
  const refreshDeploys = async (name: string) => {
    try { setDeploys(await eng.call<Deploy[]>("GET", `/api/projects/${name}/deployments`)); } catch (e) { toast.error(String(e)); }
  };

  useEffect(() => { ping(); if (eng.token) refreshProjects(); const i = setInterval(ping, 5000); return () => clearInterval(i); }, [eng.url, eng.token]);
  useEffect(() => { if (selected) refreshDeploys(selected); }, [selected]);

  // stream logs
  useEffect(() => {
    if (!activeDeploy) return;
    setLogs([]);
    const ws = new WebSocket(eng.url.replace(/^http/, "ws") + "/ws?deployment=" + activeDeploy);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try { const m = JSON.parse(ev.data); setLogs((l) => [...l, `[${m.stream}] ${m.text}`]); } catch {}
    };
    const poll = setInterval(() => selected && refreshDeploys(selected), 1500);
    return () => { ws.close(); clearInterval(poll); };
  }, [activeDeploy]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs]);

  const create = async () => {
    if (!np.name) return toast.error("name required");
    const env: Record<string, string> = {};
    for (const line of np.env.split("\n")) { const i = line.indexOf("="); if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    await eng.call("POST", "/api/projects", { name: np.name, source: np.source, buildCmd: np.buildCmd, startCmd: np.startCmd, env });
    toast.success("project saved");
    setNp({ name: "", source: "", buildCmd: "", startCmd: "", env: "" });
    refreshProjects();
  };
  const deploy = async (name: string) => {
    const r = await eng.call<{ id: string; version: string }>("POST", `/api/projects/${name}/deploy`, { trigger: "manual" });
    toast.success(`deploying ${r.version}`);
    setSelected(name); setActiveDeploy(r.id);
  };
  const rollback = async (id: string) => {
    const r = await eng.call<{ id: string }>("POST", `/api/deployments/${id}/rollback`);
    setActiveDeploy(r.id);
  };
  const remove = async (name: string) => {
    if (!confirm("delete " + name + "?")) return;
    await eng.call("DELETE", `/api/projects/${name}`); refreshProjects(); setSelected(null);
  };

  return (
    <DashboardShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Local engine</h1>
          <p className="text-sm text-muted-foreground">Real deploys against the engine running on this machine.</p>
        </div>
        <Badge variant={status === "up" ? "default" : "destructive"}>
          {status === "up" ? "● connected" : status === "down" ? "● offline" : "…"}
        </Badge>
      </div>

      <Card className="mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="text-xs text-muted-foreground">Engine URL</label>
            <Input defaultValue={eng.url} onBlur={(e) => eng.save(e.target.value, eng.token)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Bearer token</label>
            <Input type="password" defaultValue={eng.token} onBlur={(e) => eng.save(eng.url, e.target.value)} placeholder="hxt_..." />
          </div>
          <div className="flex items-end"><Button onClick={() => { ping(); refreshProjects(); }}>Reconnect</Button></div>
        </div>
        {status === "down" && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium">Engine not reachable.</p>
            <p className="text-muted-foreground">Start it locally:</p>
            <pre className="mt-2 rounded bg-black/40 p-2 text-xs">cd hosterax/engine && npm install && npm start</pre>
            <p className="mt-1 text-xs text-muted-foreground">The engine prints a bootstrap token on first run — paste it above.</p>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Projects</h3>
            <div className="space-y-1">
              {projects.length === 0 && <p className="text-xs text-muted-foreground">none yet</p>}
              {projects.map((p) => (
                <button key={p.name} onClick={() => setSelected(p.name)}
                  className={"flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted " + (selected === p.name ? "bg-muted" : "")}>
                  <span className="truncate">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">{p.target}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">New project</h3>
            <div className="space-y-2">
              <Input placeholder="name" value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
              <Input placeholder="source (local path or git URL)" value={np.source} onChange={(e) => setNp({ ...np, source: e.target.value })} />
              <Input placeholder='build cmd (e.g. "npm install && npm run build")' value={np.buildCmd} onChange={(e) => setNp({ ...np, buildCmd: e.target.value })} />
              <Input placeholder='start cmd (e.g. "npm start")' value={np.startCmd} onChange={(e) => setNp({ ...np, startCmd: e.target.value })} />
              <Textarea placeholder={"env vars\nKEY=value\nPORT=3000"} rows={3} value={np.env} onChange={(e) => setNp({ ...np, env: e.target.value })} />
              <Button className="w-full" onClick={create}>Save</Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {selected ? (
            <>
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{selected}</h3>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => deploy(selected)}>Deploy</Button>
                    <Button size="sm" variant="outline" onClick={() => remove(selected)}>Delete</Button>
                  </div>
                </div>
                <div className="space-y-1">
                  {deploys.length === 0 && <p className="text-xs text-muted-foreground">no deployments yet</p>}
                  {deploys.map((d) => (
                    <div key={d.id} className="flex items-center justify-between rounded border border-border/60 px-3 py-2 text-xs">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setActiveDeploy(d.id)} className={"font-mono " + (activeDeploy === d.id ? "text-primary" : "")}>{d.version}</button>
                        <Badge variant="outline" className="text-[10px]">{d.phase}</Badge>
                        <span className="text-muted-foreground">{d.trigger}</span>
                        <span className="text-muted-foreground">{new Date(d.started_at).toLocaleString()}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => rollback(d.id)}>Rollback</Button>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-0 overflow-hidden">
                <div className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
                  Live logs {activeDeploy && <span className="font-mono">· {activeDeploy}</span>}
                </div>
                <div ref={logRef} className="h-96 overflow-auto bg-black/60 p-3 font-mono text-[11px] leading-relaxed">
                  {logs.length === 0 && <div className="text-muted-foreground">waiting for output…</div>}
                  {logs.map((l, i) => (
                    <div key={i} className={l.startsWith("[stderr]") ? "text-red-400" : l.startsWith("[system]") ? "text-primary" : "text-foreground/90"}>{l}</div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <Card className="p-10 text-center text-sm text-muted-foreground">Select or create a project on the left.</Card>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
