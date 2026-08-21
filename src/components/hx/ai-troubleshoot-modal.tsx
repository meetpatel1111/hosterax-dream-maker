// src/components/hx/ai-troubleshoot-modal.tsx
// Contextual AI Troubleshooting & 1-Click Automated Remediation Modal

import React, { useState, useEffect } from "react";
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Zap,
  Terminal,
  Shield,
  ArrowRight,
  ExternalLink,
  X,
} from "lucide-react";
import { useAiDiagnose, useAiExecuteFix, type AiDiagnosticResult } from "@/lib/engine";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

interface AiTroubleshootModalProps {
  projectName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function AiTroubleshootModal({
  projectName,
  isOpen,
  onClose,
}: AiTroubleshootModalProps) {
  const { user } = useAuth();
  const userRole = (user?.role as string) || "admin";

  const diagnoseMutation = useAiDiagnose();
  const executeFixMutation = useAiExecuteFix();

  const [diagnosticResult, setDiagnosticResult] = useState<AiDiagnosticResult | null>(null);
  const [fixSuccessMessage, setFixSuccessMessage] = useState<string | null>(null);
  const [activeFixId, setActiveFixId] = useState<string | null>(null);

  const runDiagnosis = async () => {
    setFixSuccessMessage(null);
    try {
      const res = await diagnoseMutation.mutateAsync(projectName);
      setDiagnosticResult(res);
    } catch {}
  };

  useEffect(() => {
    if (isOpen && projectName) {
      runDiagnosis();
    }
  }, [isOpen, projectName]);

  const handleApplyFix = async (fix: { id: string; type: string; parameters: Record<string, any> }) => {
    setActiveFixId(fix.id);
    setFixSuccessMessage(null);
    try {
      const res = await executeFixMutation.mutateAsync({
        projectName,
        fixType: fix.type,
        parameters: fix.parameters,
        userRole,
      });
      if (res.success) {
        setFixSuccessMessage(res.message);
        // Re-run diagnosis after applying fix
        setTimeout(() => runDiagnosis(), 1500);
      }
    } catch (err: any) {
      setFixSuccessMessage(`❌ Failed: ${err.message}`);
    } finally {
      setActiveFixId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden font-sans animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 p-4 bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 border border-primary/30 text-primary">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                Autonomous AI Troubleshooting
                <span className="font-mono text-xs text-muted-foreground">({projectName})</span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Deep root-cause failure analysis, log forensics, and 1-click remediation recipes.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={runDiagnosis}
              disabled={diagnoseMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors border border-border/60"
              title="Re-run Diagnostic Scan"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", diagnoseMutation.isPending && "animate-spin")} />
              <span>Rescan</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-4 text-xs">
          {/* Loading State */}
          {diagnoseMutation.isPending && (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="font-mono text-xs">Inspecting container state, memory heap, and exit codes...</p>
            </div>
          )}

          {/* Results Display */}
          {!diagnoseMutation.isPending && diagnosticResult && (
            <>
              {/* Status Banner */}
              <div
                className={cn(
                  "flex items-center justify-between rounded-xl p-3.5 border",
                  diagnosticResult.status === "healthy"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : diagnosticResult.status === "warning"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                )}
              >
                <div className="flex items-center gap-2.5">
                  {diagnosticResult.status === "healthy" ? (
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                  )}
                  <div>
                    <h4 className="font-semibold text-xs capitalize">
                      {diagnosticResult.status === "healthy"
                        ? "Service Online & Healthy"
                        : `${diagnosticResult.status} Fault Detected`}
                    </h4>
                    <p className="text-[11px] opacity-80">
                      Container: <code className="font-mono">hx_{projectName}</code> · Target:{" "}
                      <code className="font-mono">{diagnosticResult.target}</code> · Ingress:{" "}
                      <code className="font-mono">{diagnosticResult.domain}</code>
                    </p>
                  </div>
                </div>

                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-background/50 uppercase">
                  {diagnosticResult.isRunning ? "RUNNING" : "STOPPED"}
                </span>
              </div>

              {/* Fix Success Notification */}
              {fixSuccessMessage && (
                <div className="rounded-lg bg-primary/10 border border-primary/30 p-3 text-primary text-xs font-medium flex items-center gap-2">
                  <Zap className="w-4 h-4 shrink-0" />
                  <span>{fixSuccessMessage}</span>
                </div>
              )}

              {/* Identified Issues */}
              {diagnosticResult.issues && diagnosticResult.issues.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider font-mono text-[11px]">
                    Identified Root Causes ({diagnosticResult.issues.length})
                  </h4>
                  {diagnosticResult.issues.map((iss, i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-border/70 bg-card p-3 space-y-1.5 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground text-xs">{iss.title}</span>
                        <span className="text-[10px] font-mono uppercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {iss.type}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{iss.description}</p>
                      {iss.evidence && (
                        <div className="rounded bg-muted/60 p-2 font-mono text-[10px] text-destructive whitespace-pre-wrap border border-border/40">
                          {iss.evidence}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 1-Click Automated Remediations */}
              {diagnosticResult.fixes && diagnosticResult.fixes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider font-mono text-[11px]">
                    1-Click Automated Remediations
                  </h4>
                  <div className="space-y-2">
                    {diagnosticResult.fixes.map((fix) => (
                      <div
                        key={fix.id}
                        className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 p-3.5 gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <Zap className="w-3.5 h-3.5 text-primary" />
                            <span className="font-semibold text-foreground text-xs">{fix.title}</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{fix.description}</p>
                        </div>

                        <button
                          onClick={() => handleApplyFix(fix)}
                          disabled={activeFixId === fix.id || executeFixMutation.isPending}
                          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-all shadow-sm active:scale-95 shrink-0 disabled:opacity-50"
                        >
                          {activeFixId === fix.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ArrowRight className="w-3.5 h-3.5" />
                          )}
                          <span>Apply Auto-Fix</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Log Forensics */}
              {diagnosticResult.recentLogs && (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider font-mono text-[11px]">
                    Recent Log Forensics (Last 25 lines)
                  </h4>
                  <pre className="max-h-40 overflow-y-auto rounded-lg bg-background p-3 font-mono text-[10px] text-muted-foreground border border-border/80 whitespace-pre-wrap leading-tight">
                    {diagnosticResult.recentLogs}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
