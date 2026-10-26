import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, LockOpen } from "lucide-react";
import { useEngine } from "@/lib/engine";

type GateState = { enabled: boolean; port?: number; updatedAt?: number };

/** A password in front of the app: visitors must enter it before they can reach anything. */
export function ProjectGateCard({ projectName }: { projectName: string }) {
  const engine = useEngine();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const key = ["project-gate", projectName, engine.url];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => engine.call<GateState>("GET", `/api/projects/${projectName}/gate`),
  });

  async function save() {
    setBusy(true);
    try {
      const r = await engine.call<GateState & { note?: string }>(
        "PUT",
        `/api/projects/${projectName}/gate`,
        { password },
      );
      toast.success(
        data?.enabled ? "Password changed. Everyone was signed out." : "Password protection is on.",
      );
      if (r.note && !data?.enabled) toast.info(r.note, { duration: 9000 });
      setPassword("");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["project"] });
    } catch (e: any) {
      toast.error(e.message || "Could not set the password");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!confirm("Remove the password? Anyone with the address will be able to open the app."))
      return;
    try {
      await engine.call("DELETE", `/api/projects/${projectName}/gate`);
      toast.success("Password protection is off.");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["project"] });
    } catch (e: any) {
      toast.error(e.message || "Could not turn it off");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        {data?.enabled ? (
          <Lock className="h-4 w-4 text-primary" />
        ) : (
          <LockOpen className="h-4 w-4 text-muted-foreground" />
        )}
        Password protection
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
          {data?.enabled ? "on" : "off"}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Visitors see a password page before they can reach the app, whether they arrive through a
        domain, the edge, or a public address. Sessions last 12 hours. The password is stored only
        as a hash. Redeploy after turning it on so the app's own port is no longer reachable from
        the network.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={
            data?.enabled
              ? "New password (signs everyone out)"
              : "Choose a password (8+ characters)"
          }
          autoComplete="new-password"
          className="min-w-[14rem] flex-1 rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          onClick={save}
          disabled={busy || password.length < 8}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {data?.enabled ? "Change password" : "Turn on"}
        </button>
        {data?.enabled && (
          <button
            onClick={turnOff}
            className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          >
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}
