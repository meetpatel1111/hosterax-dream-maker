import React, { useState } from "react";
import {
  Archive,
  Trash2,
  AlertTriangle,
  X,
  Check,
  RefreshCw,
  HardDrive,
  ShieldAlert,
} from "lucide-react";

interface DeleteProjectModalProps {
  isOpen: boolean;
  projectName: string;
  onClose: () => void;
  onConfirm: (permanent: boolean) => Promise<void>;
  isBusy?: boolean;
}

export function DeleteProjectModal({
  isOpen,
  projectName,
  onClose,
  onConfirm,
  isBusy = false,
}: DeleteProjectModalProps) {
  const [permanent, setPermanent] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          disabled={isBusy}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
              permanent
                ? "bg-destructive/15 border-destructive/30 text-destructive"
                : "bg-amber-500/15 border-amber-500/30 text-amber-400"
            }`}
          >
            {permanent ? <Trash2 className="h-5 w-5" /> : <Archive className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              {permanent ? "Permanently Purge Project" : "Delete & Archive Project"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Target service:{" "}
              <span className="font-mono font-semibold text-foreground">{projectName}</span>
            </p>
          </div>
        </div>

        {/* Option Selection Cards */}
        <div className="space-y-2.5">
          {/* Option 1: Soft Delete / Archive */}
          <div
            onClick={() => !isBusy && setPermanent(false)}
            className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-start gap-3 ${
              !permanent
                ? "border-amber-500/50 bg-amber-500/5 shadow-sm"
                : "border-border bg-surface/40 hover:border-border/80"
            }`}
          >
            <div
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                !permanent
                  ? "border-amber-500 bg-amber-500 text-black"
                  : "border-muted-foreground/40"
              }`}
            >
              {!permanent && <Check className="h-2.5 w-2.5 stroke-[3]" />}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Archive & Free Disk Space
                </span>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.2 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                  Recommended
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Immediately terminates processes/containers and{" "}
                <strong className="text-foreground">
                  purges all cloned source code, node_modules, and build files from disk
                </strong>{" "}
                (0 MB footprint). Preserves configuration and env vars for 1-click restore.
              </p>
            </div>
          </div>

          {/* Option 2: Permanent Purge */}
          <div
            onClick={() => !isBusy && setPermanent(true)}
            className={`cursor-pointer rounded-xl border p-3.5 transition-all flex items-start gap-3 ${
              permanent
                ? "border-destructive/50 bg-destructive/5 shadow-sm"
                : "border-border bg-surface/40 hover:border-border/80"
            }`}
          >
            <div
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                permanent
                  ? "border-destructive bg-destructive text-white"
                  : "border-muted-foreground/40"
              }`}
            >
              {permanent && <Check className="h-2.5 w-2.5 stroke-[3]" />}
            </div>
            <div className="space-y-1">
              <span className="text-sm font-semibold text-foreground">
                Permanently Purge Everything
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Deletes all disk files, database records, deployment histories, and domain mappings
                permanently. <strong className="text-destructive">Cannot be undone.</strong>
              </p>
            </div>
          </div>
        </div>

        {/* Warning Banner */}
        <div
          className={`flex items-center gap-2.5 rounded-xl border p-3 text-xs ${
            permanent
              ? "bg-destructive/10 border-destructive/20 text-destructive"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
          }`}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {permanent
              ? "All audit history and environment variables will be erased forever."
              : "Disk space will be 100% reclaimed. You can restore this project anytime from the Archived tab."}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-xl border border-border bg-surface px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(permanent)}
            disabled={isBusy}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-md transition-all disabled:opacity-50 ${
              permanent
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-amber-600 hover:bg-amber-500 text-black font-semibold"
            }`}
          >
            {isBusy ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Processing...</span>
              </>
            ) : permanent ? (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                <span>Purge Permanently</span>
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5 text-black" />
                <span>Archive & Clean Disk</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
