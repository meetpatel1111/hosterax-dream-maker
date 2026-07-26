import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEngine } from "@/lib/engine";
import { Cpu, Server, Plus, Loader2 } from "lucide-react";
import { QuotaGauges } from "@/components/hx/quota-gauges";
import { AddServerDialog } from "@/components/hx/add-server-dialog";
import { useState } from "react";

export const Route = createFileRoute("/_app/servers")({
  head: () => ({ meta: [{ title: "Servers — HosteraX" }] }),
  component: ServersPage,
});

function ServersPage() {
  const engine = useEngine();
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: servers, isLoading } = useQuery({
    queryKey: ["servers", engine.url],
    queryFn: async () => {
      try {
        const res = await engine.call<any[]>("GET", "/api/servers");
        return res ?? [];
      } catch (e) {
        return [];
      }
    },
    refetchInterval: 5000,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servers</h1>
          <p className="text-sm text-muted-foreground">Manage your self-hosted compute nodes</p>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add Server
        </button>
      </div>

      <QuotaGauges />

      <div className="rounded-lg border border-border bg-card">
        <div className="p-4">
          <h3 className="text-lg font-medium">Connected Nodes</h3>
        </div>
        <div className="divide-y divide-border border-t border-border">
          {isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : servers?.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
              <Server className="mb-2 h-10 w-10 opacity-20" />
              <p>No servers connected.</p>
              <p className="text-xs">Add your first target node to start deploying applications.</p>
            </div>
          ) : (
            servers?.map((server) => (
              <div key={server.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Cpu className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="font-medium">{server.name}</div>
                    <div className="text-xs text-muted-foreground">{server.ip_address}</div>
                  </div>
                </div>
                <div className="text-right text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 font-medium text-success">
                    Online
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <AddServerDialog open={showAddModal} onOpenChange={setShowAddModal} />
    </div>
  );
}


