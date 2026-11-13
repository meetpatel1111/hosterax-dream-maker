import { useState } from "react";
import { toast } from "sonner";
import {
  Play,
  Table as TableIcon,
  Download,
  Copy,
  Clock,
  Check,
  Code2,
  Sparkles,
} from "lucide-react";
import { useEngine } from "@/lib/engine";

interface DatabaseStudioProps {
  databases: Array<{
    id: string;
    project: string;
    name: string;
    engine: string;
    size_mb: number;
    status: string;
  }>;
}

const PRESET_QUERIES = [
  {
    name: "Deployed Projects",
    description: "Inspect registered applications, sources, runtime targets, and CPU/RAM quotas",
    sql: "SELECT name, source, target, cpu_limit, memory_mb_limit, created_at FROM projects ORDER BY created_at DESC;",
  },
  {
    name: "SQLite Schema Explorer",
    description: "Inspect tables and views defined in the HosteraX control plane database",
    sql: "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;",
  },
  {
    name: "API Tokens & Scopes",
    description: "Audit issued API access tokens, creation timestamps, and permission scopes",
    sql: "SELECT name, created_at, scopes_json FROM tokens ORDER BY created_at DESC;",
  },
  {
    name: "Scheduled Cron Jobs",
    description: "List recurring cron jobs, targets, schedules, and next execution timestamps",
    sql: "SELECT id, name, project_name, schedule_type, cron_expression, enabled, next_run_at FROM cron_jobs ORDER BY id DESC;",
  },
  {
    name: "Recent Audit Trail",
    description: "Query recent administrative mutations, logins, and security policy events",
    sql: "SELECT id, org_id, actor_email, action, resource_type, resource_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 25;",
  },
];

export function DatabaseStudio({ databases }: DatabaseStudioProps) {
  const engine = useEngine();
  const [selectedDb, setSelectedDb] = useState<string>("engine-sqlite (hosterax.db)");
  const [sqlQuery, setSqlQuery] = useState<string>(PRESET_QUERIES[0].sql);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const [queryResult, setQueryResult] = useState<{
    columns: string[];
    rows: any[];
    durationMs: number;
    executedAt: string;
    target?: string;
    error?: string;
  } | null>(null);

  const runQuery = async (customQuery?: string) => {
    const q = (customQuery || sqlQuery).trim();
    if (!q) {
      toast.error("Please enter a SQL query to run");
      return;
    }

    const target = selectedDb.startsWith("engine-sqlite") ? "engine-sqlite" : selectedDb;

    setRunning(true);
    try {
      const res = await engine.call<{
        ok: boolean;
        target: string;
        engine: string;
        columns: string[];
        rows: any[];
        rowCount: number;
        durationMs: number;
        rawOutput?: string;
      }>("POST", "/api/databases/query", { target, query: q });

      const rows = Array.isArray(res.rows) ? res.rows : [];
      const columns =
        Array.isArray(res.columns) && res.columns.length > 0
          ? res.columns
          : rows.length > 0
            ? Object.keys(rows[0])
            : ["result"];

      setQueryResult({
        columns,
        rows,
        durationMs: res.durationMs ?? 1,
        executedAt: new Date().toLocaleTimeString(),
        target: res.target,
      });
      toast.success(`Query completed in ${res.durationMs ?? 1}ms (${rows.length} rows)`);
    } catch (err: any) {
      setQueryResult({
        columns: ["error"],
        rows: [],
        durationMs: 0,
        executedAt: new Date().toLocaleTimeString(),
        error: err?.message || "Query execution failed",
      });
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = () => {
    if (!queryResult || !queryResult.rows.length) return;
    const headers = queryResult.columns.join(",");
    const rows = queryResult.rows.map((row) =>
      queryResult.columns.map((col) => JSON.stringify(row[col] ?? "")).join(","),
    );
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `hosterax-query-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Exported query results as CSV");
  };

  const copyResults = async () => {
    if (!queryResult) return;
    await navigator.clipboard.writeText(JSON.stringify(queryResult.rows, null, 2));
    setCopied(true);
    toast.success("Copied results JSON to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6" data-testid="database-studio">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
            <TableIcon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Database Studio &amp; Read-Only SQL Console
            </h3>
            <p className="text-xs text-muted-foreground">
              Validated read-only queries against engine SQLite and running managed database
              containers.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium hidden md:inline">
            Active Target:
          </span>
          <select
            aria-label="Select target database"
            value={selectedDb}
            onChange={(e) => setSelectedDb(e.target.value)}
            className="rounded-lg border border-input bg-input/40 px-3 py-1.5 text-xs font-mono outline-none focus:border-primary shadow-xs"
          >
            <option value="engine-sqlite (hosterax.db)">engine-sqlite (hosterax.db)</option>
            {databases.map((db) => (
              <option key={db.id} value={db.name}>
                {db.name} ({db.engine} · {db.project})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Quick Presets
            </span>
            <span className="text-[11px] text-muted-foreground font-mono">READ-ONLY SQL</span>
          </div>

          <div className="space-y-2">
            {PRESET_QUERIES.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => {
                  setSqlQuery(preset.sql);
                  runQuery(preset.sql);
                }}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  sqlQuery === preset.sql
                    ? "border-primary bg-primary/5 shadow-xs"
                    : "border-border/70 bg-card/40 hover:bg-muted/40"
                }`}
              >
                <div className="text-xs font-semibold text-foreground">{preset.name}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5 text-cyan-400" />
              SQL Scratchpad
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">
              SELECT / WITH / EXPLAIN / PRAGMA (Ctrl+Enter)
            </span>
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs">
            <textarea
              rows={4}
              aria-label="SQL Query"
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  runQuery();
                }
              }}
              placeholder="SELECT name, source, target FROM projects;"
              className="w-full rounded-lg border border-input bg-input/40 p-3 font-mono text-xs outline-none focus:border-primary"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="btn-run-query"
                  onClick={() => runQuery()}
                  disabled={running}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-xs disabled:opacity-50"
                >
                  <Play className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} />
                  <span>{running ? "Running..." : "Run Query"}</span>
                </button>
              </div>

              {queryResult && !queryResult.error && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyResults}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 shadow-2xs"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>Copy JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={exportCsv}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 shadow-2xs"
                  >
                    <Download className="h-3 w-3" />
                    <span>Export CSV</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3.5 bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">Query Results Data Grid</span>
            {queryResult && !queryResult.error && (
              <span className="rounded bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-mono">
                {queryResult.rows.length} row{queryResult.rows.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {queryResult && (
            <div className="flex items-center gap-3 text-xs font-mono text-muted-foreground">
              {queryResult.target && <span>{queryResult.target}</span>}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {queryResult.durationMs}ms
              </span>
              <span>·</span>
              <span>{queryResult.executedAt}</span>
            </div>
          )}
        </div>

        {!queryResult && (
          <div className="p-12 text-center text-xs text-muted-foreground">
            Click &quot;Run Query&quot; or choose a preset to execute a real database query.
          </div>
        )}

        {queryResult?.error && (
          <div className="p-6 text-xs text-destructive bg-destructive/5 font-mono">
            {queryResult.error}
          </div>
        )}

        {queryResult && !queryResult.error && queryResult.rows.length === 0 && (
          <div className="p-8 text-center text-xs text-muted-foreground font-mono">
            Query executed cleanly — 0 rows returned.
          </div>
        )}

        {queryResult && !queryResult.error && queryResult.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-muted/40 text-muted-foreground border-b border-border/80">
                <tr>
                  {queryResult.columns.map((col) => (
                    <th
                      key={col}
                      className="px-4 py-2.5 font-semibold text-foreground uppercase text-[11px]"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {queryResult.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-muted/20 transition-colors">
                    {queryResult.columns.map((col) => (
                      <td
                        key={col}
                        className="px-4 py-2 text-foreground/90 whitespace-nowrap max-w-[360px] truncate"
                        title={
                          typeof row[col] === "object"
                            ? JSON.stringify(row[col])
                            : String(row[col] ?? "null")
                        }
                      >
                        {typeof row[col] === "object" && row[col] !== null
                          ? JSON.stringify(row[col])
                          : String(row[col] ?? "null")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
