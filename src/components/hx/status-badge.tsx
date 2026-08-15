import { cn } from "@/lib/utils";

const MAP: Record<string, { label: string; cls: string; dot: string }> = {
  active: {
    label: "Active",
    cls: "bg-success/10 text-success border-success/30",
    dot: "bg-success",
  },
  success: {
    label: "Success",
    cls: "bg-success/10 text-success border-success/30",
    dot: "bg-success",
  },
  building: {
    label: "Building",
    cls: "bg-warning/10 text-warning border-warning/30",
    dot: "bg-warning animate-pulse",
  },
  deploying: {
    label: "Deploying",
    cls: "bg-info/10 text-info border-info/30",
    dot: "bg-info animate-pulse",
  },
  queued: {
    label: "Queued",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  failed: {
    label: "Failed",
    cls: "bg-destructive/10 text-destructive border-destructive/30",
    dot: "bg-destructive",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  sleeping: {
    label: "Sleeping",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  archived: {
    label: "Archived",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  running: {
    label: "Running",
    cls: "bg-success/10 text-success border-success/30",
    dot: "bg-success",
  },
  provisioning: {
    label: "Provisioning",
    cls: "bg-warning/10 text-warning border-warning/30",
    dot: "bg-warning animate-pulse",
  },
  stopped: {
    label: "Stopped",
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const m = MAP[status] ?? {
    label: status,
    cls: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        m.cls,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}
