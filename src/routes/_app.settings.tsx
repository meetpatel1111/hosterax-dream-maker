import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — HosteraX" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePw() {
    if (pw.length < 6) return toast.error("Password too short");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    setPw("");
    toast.success("Password updated");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Your account and control plane.</p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Account</div>
        <div className="mt-3 grid gap-3 text-sm">
          <Row k="Email" v={user?.email ?? "—"} />
          <Row k="User ID" v={<span className="font-mono text-xs">{user?.id}</span>} />
          <Row k="Signed in" v={user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "—"} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Change password</div>
        <div className="mt-3 flex gap-2">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password"
            className="flex-1 rounded-md border border-input bg-input/40 px-3 py-2 text-sm outline-none focus:border-primary" />
          <button onClick={changePw} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            Update
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="text-sm font-medium">Instance</div>
        <div className="mt-3 grid gap-3 text-sm">
          <Row k="Version" v="HosteraX v0.2.2" />
          <Row k="License" v="Apache 2.0" />
          <Row k="Mode" v="Self-hosted (control plane)" />
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
