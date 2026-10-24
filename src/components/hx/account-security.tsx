import { useState } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useEngine } from "@/lib/engine";
import { useAuth } from "@/lib/auth-context";

const inputClass =
  "w-full rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary";

type TwoFactorSetup = { secret: string; otpauthUri: string };

/** Password and two-factor settings for the signed-in user account. */
export function AccountSecurity() {
  const engine = useEngine();
  const { session, refreshSession } = useAuth();
  const account = session?.account;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (!account) return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      toast.error(e?.message || "That did not work");
    } finally {
      setBusy(false);
    }
  }

  const changePassword = () =>
    run(async () => {
      await engine.call("POST", "/api/auth/password", { current, next });
      toast.success("Password changed — your other sessions were signed out");
      setCurrent("");
      setNext("");
    });

  const startTwoFactor = () =>
    run(async () => {
      setSetup(await engine.call<TwoFactorSetup>("POST", "/api/auth/2fa/setup"));
    });

  const enableTwoFactor = () =>
    run(async () => {
      const r = await engine.call<{ recoveryCodes: string[] }>("POST", "/api/auth/2fa/enable", {
        code,
      });
      setRecovery(r.recoveryCodes);
      setSetup(null);
      setCode("");
      await refreshSession();
      toast.success("Two-factor authentication is on");
    });

  const disableTwoFactor = () =>
    run(async () => {
      await engine.call("POST", "/api/auth/2fa/disable", {
        password: disablePassword,
        code: disableCode,
      });
      setDisablePassword("");
      setDisableCode("");
      await refreshSession();
      toast.success("Two-factor authentication is off");
    });

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-6">
      <div>
        <div className="text-sm font-medium">Your account</div>
        <p className="mt-1 text-xs text-muted-foreground">
          {account.name || account.email} · {account.email} · role{" "}
          <span className="font-mono">{account.role}</span>
          {account.authSource === "oidc" ? " · signs in with SSO" : ""}
        </p>
      </div>

      {account.authSource === "password" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <KeyRound className="h-4 w-4 text-primary" /> Change password
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputClass}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password (10+ characters)"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            disabled={busy || !current || next.length < 10}
            onClick={changePassword}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            Change password
          </button>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          {account.twoFactorEnabled ? (
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          ) : (
            <ShieldOff className="h-4 w-4 text-muted-foreground" />
          )}
          Two-factor authentication: {account.twoFactorEnabled ? "on" : "off"}
        </div>

        {account.authSource === "oidc" && (
          <p className="text-xs text-muted-foreground">
            This account signs in through your identity provider, which handles two-factor
            authentication.
          </p>
        )}

        {account.authSource === "password" && !account.twoFactorEnabled && !setup && (
          <>
            <p className="text-xs text-muted-foreground">
              Ask for a code from an authenticator app (Google Authenticator, 1Password, Authy…)
              after the password.
            </p>
            <button
              disabled={busy}
              onClick={startTwoFactor}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Set up two-factor
            </button>
          </>
        )}

        {setup && (
          <div className="space-y-2 rounded-md border border-border p-3 text-xs">
            <p>
              Add this account to your authenticator app by entering the key below (or open the link
              on a device that has one), then type the 6-digit code it shows.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-muted px-2 py-1 font-mono select-all">
                {setup.secret}
              </code>
              <button
                onClick={() => copy(setup.secret)}
                className="rounded border border-border px-2 py-1 hover:bg-accent"
                title="Copy key"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <a href={setup.otpauthUri} className="text-primary underline">
              Open in an authenticator app
            </a>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={`${inputClass} max-w-[10rem] font-mono tracking-widest`}
              />
              <button
                disabled={busy || code.length < 6}
                onClick={enableTwoFactor}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Turn on
              </button>
              <button
                onClick={() => setSetup(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {recovery && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <p className="font-semibold text-amber-400">
              Save these recovery codes now — they are shown once. Each works one time if you lose
              your device.
            </p>
            <div className="grid grid-cols-2 gap-1 font-mono">
              {recovery.map((c) => (
                <span key={c} className="select-all">
                  {c}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => copy(recovery.join("\n"))}
                className="rounded border border-border px-2 py-1 hover:bg-accent"
              >
                Copy all
              </button>
              <button
                onClick={() => setRecovery(null)}
                className="rounded border border-border px-2 py-1 hover:bg-accent"
              >
                I have saved them
              </button>
            </div>
          </div>
        )}

        {account.twoFactorEnabled && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              To turn it off, confirm with your password and a current code (or a recovery code).
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                className={inputClass}
              />
              <input
                placeholder="Code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <button
              disabled={busy || !disablePassword || !disableCode}
              onClick={disableTwoFactor}
              className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              Turn off two-factor
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
