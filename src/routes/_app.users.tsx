import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Lock, ShieldCheck, Trash2, UserPlus, UserCog } from "lucide-react";
import { useEngine } from "@/lib/engine";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_app/users")({
  head: () => ({
    meta: [
      { title: "Users & access — HosteraX" },
      { name: "description", content: "Accounts, roles and sign-in security for HosteraX." },
    ],
  }),
  component: UsersPage,
});

const ROLES = ["owner", "admin", "developer", "viewer"] as const;
type Role = (typeof ROLES)[number];

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including managing admins and owners. There is always at least one owner.",
  admin: "Manages developers and viewers, API tokens, servers and settings.",
  developer: "Deploys and changes projects, domains, databases and backups.",
  viewer: "Read-only access.",
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  twoFactorEnabled: boolean;
  authSource: "password" | "oidc";
  createdAt: number;
  lastLoginAt: number | null;
};

type AuthEvent = {
  id: number;
  ts: number;
  email: string | null;
  event: string;
  ip: string | null;
  detail: string | null;
};

const inputClass =
  "rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary";

function UsersPage() {
  const engine = useEngine();
  const qc = useQueryClient();
  const { session, signIn } = useAuth();
  const me = session?.account ?? null;

  const {
    data: users,
    error,
    isLoading,
  } = useQuery({
    queryKey: ["users", engine.url, engine.token],
    queryFn: () => engine.call<UserRow[]>("GET", "/api/users"),
    retry: false,
    refetchInterval: 10000,
  });
  const { data: events = [] } = useQuery({
    queryKey: ["auth-events", engine.url, engine.token],
    queryFn: () => engine.call<AuthEvent[]>("GET", "/api/auth/events?limit=40"),
    enabled: !!users && users.length > 0,
    retry: false,
  });

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // what the current identity may hand out: owners and tokens/local everything, admins only the lower roles
  const myRole: Role | "system" = me?.role ?? "system";
  const grantable = (r: Role) =>
    myRole === "system" ||
    myRole === "owner" ||
    (myRole === "admin" && (r === "developer" || r === "viewer"));

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });
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

  if (error) {
    const forbidden = /scope|forbidden|403/i.test((error as Error).message);
    return (
      <div className="mx-auto max-w-3xl rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {forbidden
          ? "Managing users needs an admin: sign in with an admin account or token."
          : (error as Error).message}
      </div>
    );
  }
  if (isLoading || !users) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // First run: nobody has an account yet.
  if (users.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Create the owner account</h1>
          <p className="text-sm text-muted-foreground">
            This engine has no user accounts yet. The owner can add everyone else and assign roles.
            API tokens and access from this machine keep working as before.
          </p>
        </div>
        <form
          className="space-y-3 rounded-lg border border-border bg-card p-5"
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              const r = await engine.call<{ token: string }>("POST", "/api/auth/setup", {
                email,
                name,
                password,
              });
              await signIn(r.token); // continue as the new owner
            }, "Owner account created");
          }}
        >
          <input
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} w-full`}
          />
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} w-full`}
          />
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={10}
            placeholder="Password (10+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} w-full`}
          />
          <button
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Create owner
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <UserCog className="h-6 w-6 text-primary" /> Users &amp; access
        </h1>
        <p className="text-sm text-muted-foreground">
          People who sign in to this engine and what they may do. Roles apply across the whole
          engine and are enforced on every request, so a change takes effect immediately.
        </p>
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-card p-4 text-xs sm:grid-cols-2">
        {ROLES.map((r) => (
          <div key={r}>
            <span className="font-mono font-semibold">{r}</span>
            <span className="text-muted-foreground"> — {ROLE_HELP[r]}</span>
          </div>
        ))}
      </div>

      <form
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            await engine.call("POST", "/api/users", { email, name, role, password });
            setEmail("");
            setName("");
            setPassword("");
          }, "User added");
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <UserPlus className="h-4 w-4 text-primary" /> Add a user
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <input
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} md:col-span-2`}
          />
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={inputClass}
          >
            {ROLES.filter(grantable).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={10}
            placeholder="Password (10+)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <button
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Add user
        </button>
        <p className="text-[11px] text-muted-foreground">
          Share the password through a safe channel; they can change it and turn on two-factor in
          Settings after signing in.
        </p>
      </form>

      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {users.map((u) => {
          const isMe = me?.id === u.id;
          const manageable = grantable(u.role) && !isMe;
          return (
            <div
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 font-medium">
                  {u.name || u.email}
                  {isMe && (
                    <span className="rounded bg-primary/15 px-1.5 text-[10px] text-primary">
                      you
                    </span>
                  )}
                  {u.disabled && (
                    <span className="rounded bg-destructive/15 px-1.5 text-[10px] text-destructive">
                      disabled
                    </span>
                  )}
                  {u.twoFactorEnabled && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
                      <ShieldCheck className="h-3 w-3" /> 2FA
                    </span>
                  )}
                  {u.authSource === "oidc" && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Lock className="h-3 w-3" /> SSO
                    </span>
                  )}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {u.email} · last sign-in{" "}
                  {u.lastLoginAt
                    ? formatDistanceToNow(new Date(u.lastLoginAt), { addSuffix: true })
                    : "never"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={u.role}
                  disabled={busy || !manageable}
                  onChange={(e) =>
                    act(
                      () => engine.call("PATCH", `/api/users/${u.id}`, { role: e.target.value }),
                      "Role updated",
                    )
                  }
                  className={`${inputClass} py-1 text-xs`}
                  title={manageable ? "Change role" : "You cannot change this user's role"}
                >
                  {ROLES.filter((r) => grantable(r) || r === u.role).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {manageable && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(
                          () =>
                            engine.call("PATCH", `/api/users/${u.id}`, { disabled: !u.disabled }),
                          u.disabled ? "User enabled" : "User disabled and signed out",
                        )
                      }
                      className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
                    >
                      {u.disabled ? "Enable" : "Disable"}
                    </button>
                    {u.authSource === "password" && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          const next = window.prompt(
                            `New password for ${u.email} (10+ characters)`,
                          );
                          if (next)
                            act(
                              () => engine.call("PATCH", `/api/users/${u.id}`, { password: next }),
                              "Password set — their sessions were signed out",
                            );
                        }}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
                      >
                        Set password
                      </button>
                    )}
                    {u.twoFactorEnabled && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              `Remove two-factor authentication for ${u.email}? They will be signed out.`,
                            )
                          )
                            act(
                              () => engine.call("POST", `/api/users/${u.id}/2fa-reset`),
                              "Two-factor removed",
                            );
                        }}
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
                      >
                        Reset 2FA
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Delete ${u.email}? This cannot be undone.`))
                          act(() => engine.call("DELETE", `/api/users/${u.id}`), "User deleted");
                      }}
                      className="p-1.5 text-muted-foreground hover:text-destructive"
                      title="Delete user"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">Recent sign-in activity</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left font-mono text-[11px]">
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id} className="border-t border-border/50">
                  <td className="py-1 pr-3 text-muted-foreground">
                    {new Date(ev.ts).toLocaleString()}
                  </td>
                  <td className="py-1 pr-3">{ev.event}</td>
                  <td className="py-1 pr-3">{ev.email ?? ""}</td>
                  <td className="py-1 pr-3 text-muted-foreground">{ev.ip ?? ""}</td>
                  <td className="py-1 text-muted-foreground">{ev.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
