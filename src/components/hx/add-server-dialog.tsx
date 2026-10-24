import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import { Cpu, Terminal, Key } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useEngine } from "@/lib/engine";

type AddServerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddServerDialog({ open, onOpenChange }: AddServerDialogProps) {
  const engine = useEngine();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [privateKey, setPrivateKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<"remote" | "local">("remote");

  async function handleAdd() {
    setBusy(true);
    try {
      await engine.call("POST", "/api/servers", {
        name,
        type,
        host: type === "remote" ? host : undefined,
        port: type === "remote" ? parseInt(port, 10) || 22 : undefined,
        username: type === "remote" ? username : undefined,
        private_key: type === "remote" && privateKey.trim() ? privateKey : undefined,
      });
      toast.success(
        type === "remote"
          ? "Server added. Next: put its public key on the server, then confirm the host key."
          : "Server added successfully",
      );
      qc.invalidateQueries({ queryKey: ["server-nodes"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to add server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Server Node</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setType("remote")}
              className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors ${type === "remote" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              <Terminal className="h-6 w-6" />
              <div className="font-medium">Remote VPS</div>
              <div className="text-center text-xs">
                Deploy projects to a server over SSH. Only Docker has to be installed there.
              </div>
            </button>
            <button
              onClick={() => setType("local")}
              className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors ${type === "local" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              <Cpu className="h-6 w-6" />
              <div className="font-medium">Local Machine</div>
              <div className="text-center text-xs">
                Deploy directly to the host running Control Plane.
              </div>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Server Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production Web"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            {type === "remote" && (
              <>
                <div className="grid grid-cols-4 gap-4">
                  <div className="col-span-3">
                    <label className="mb-1.5 block text-sm font-medium">Host / IP</label>
                    <input
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="203.0.113.50"
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="mb-1.5 block text-sm font-medium">Port</label>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">SSH Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium flex items-center gap-2">
                    <Key className="h-4 w-4" /> SSH Private Key (optional)
                  </label>
                  <p className="mb-1.5 text-[11px] text-muted-foreground">
                    Leave empty and HosteraX creates a key for this server; you then add its public
                    key to the server. A key you paste must have no passphrase. It is stored
                    encrypted on the engine host and never shown again.
                  </p>
                  <textarea
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----\n..."
                    className="h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border pt-4">
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={busy || !name || (type === "remote" && !host)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Adding..." : "Add Server"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
