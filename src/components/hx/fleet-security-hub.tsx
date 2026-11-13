import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ShieldAlert,
  ShieldCheck,
  XCircle,
  FileText,
  Download,
  Copy,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  SlidersHorizontal,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { useEngine, useActiveOrgId } from "../../lib/engine";

type Finding = {
  severity: "critical" | "high" | "medium" | "low";
  code: string;
  title: string;
  remediation: string;
};

type EngineSecurityScan = {
  id: string;
  target: string;
  target_type: string;
  scanner_backend: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  status: string;
  summary: string;
  findings: Finding[];
  scanned_at: number;
};

type EngineSecurityPolicy = {
  blockCritical: boolean;
  blockHigh: boolean;
  enforceNonRoot: boolean;
  requireSbom: boolean;
  maxCvss: number;
  updatedAt?: number;
};

const DEFAULT_POLICY: EngineSecurityPolicy = {
  blockCritical: true,
  blockHigh: false,
  enforceNonRoot: true,
  requireSbom: false,
  maxCvss: 9.0,
};

export function FleetSecurityHub() {
  const engine = useEngine();
  const orgId = useActiveOrgId();
  const qc = useQueryClient();

  const { data: scans = [], isLoading: isLoadingScans } = useQuery<EngineSecurityScan[]>({
    queryKey: ["security-scans", engine.url, engine.token, orgId],
    queryFn: () => engine.call<EngineSecurityScan[]>("GET", "/api/security/scans"),
  });

  const { data: savedPolicy } = useQuery<EngineSecurityPolicy>({
    queryKey: ["security-policy", engine.url, engine.token, orgId],
    queryFn: () => engine.call<EngineSecurityPolicy>("GET", "/api/security/policy"),
  });

  const [policy, setPolicy] = useState<EngineSecurityPolicy>(DEFAULT_POLICY);
  const [isScanning, setIsScanning] = useState(false);
  const [isSavingPolicy, setIsSavingPolicy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [selectedScanForReport, setSelectedScanForReport] =
    useState<EngineSecurityScan | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [lastScanStatus, setLastScanStatus] = useState<string | null>(null);

  useEffect(() => {
    if (savedPolicy) setPolicy(savedPolicy);
  }, [savedPolicy]);

  const fleetStats = useMemo(() => {
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    let cleanCount = 0;

    for (const s of scans) {
      critical += s.critical || 0;
      high += s.high || 0;
      medium += s.medium || 0;
      low += s.low || 0;
      if ((s.critical || 0) + (s.high || 0) + (s.medium || 0) + (s.low || 0) === 0) {
        cleanCount += 1;
      }
    }

    const overallGrade =
      scans.length === 0
        ? "—"
        : critical > 0
          ? "D"
          : high > 0
            ? "C"
            : medium > 0
              ? "B"
              : "A+";

    return {
      totalScanned: scans.length,
      cleanImagesCount: cleanCount,
      critical,
      high,
      medium,
      low,
      overallGrade,
    };
  }, [scans]);

  const filteredScans = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scans.filter((scan) => {
      const matchesSearch =
        !q ||
        scan.target.toLowerCase().includes(q) ||
        scan.scanner_backend.toLowerCase().includes(q) ||
        (scan.summary || "").toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (selectedSeverity === "all") return true;
      if (selectedSeverity === "clean") {
        return (scan.critical || 0) + (scan.high || 0) + (scan.medium || 0) + (scan.low || 0) === 0;
      }
      if (selectedSeverity === "critical") return scan.critical > 0;
      if (selectedSeverity === "high") return scan.high > 0;
      if (selectedSeverity === "medium") return scan.medium > 0;
      return true;
    });
  }, [scans, searchQuery, selectedSeverity]);

  const handleRescanFleet = async () => {
    setIsScanning(true);
    setLastScanStatus(null);
    try {
      const res = await engine.call<{
        ok: boolean;
        dockerAvailable: boolean;
        trivyInstalled: boolean;
        scannedCount: number;
      }>("POST", "/api/security/scan", {});
      await qc.invalidateQueries({ queryKey: ["security-scans"] });
      const msg = `Scanned ${res.scannedCount} container(s) via ${res.trivyInstalled ? "Trivy + Docker posture" : "Docker posture inspection"}`;
      setLastScanStatus(msg);
      toast.success(msg);
    } catch (err: any) {
      setLastScanStatus(err?.message || "Fleet scan unavailable");
    } finally {
      setIsScanning(false);
    }
  };

  const handleSavePolicy = async () => {
    setIsSavingPolicy(true);
    try {
      await engine.call("PUT", "/api/security/policy", policy);
      await qc.invalidateQueries({ queryKey: ["security-policy"] });
      setShowPolicyModal(false);
      toast.success("Security policy gates persisted on engine.");
    } finally {
      setIsSavingPolicy(false);
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      case "high":
        return "bg-orange-500/10 text-orange-400 border-orange-500/20";
      case "medium":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default:
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    }
  };

  const getGradeBadge = (grade: string) => {
    switch (grade) {
      case "A+":
      case "A":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "B":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "C":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "D":
      case "F":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="space-y-6" data-testid="fleet-security-hub">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <ShieldAlert className="h-6 w-6 text-primary" />
              Container Security &amp; Posture Defense
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 border border-primary/20 text-primary">
              <Lock className="h-3 w-3" />
              Zero-Trust Gating
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Real container runtime posture audits (root user, privileged mode, capability drops)
            with Trivy CVE scanning when installed on the engine host.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="btn-open-security-policy"
            onClick={() => setShowPolicyModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            Policy Gates ({policy.blockCritical ? "Strict" : "Advisory"})
          </button>

          <button
            type="button"
            data-testid="btn-scan-fleet"
            onClick={handleRescanFleet}
            disabled={isScanning}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? "animate-spin" : ""}`} />
            {isScanning ? "Scanning..." : "Scan Fleet Now"}
          </button>
        </div>
      </div>

      {lastScanStatus && (
        <div className="rounded-lg border border-border bg-card/80 px-4 py-2.5 text-xs text-muted-foreground">
          {lastScanStatus}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Fleet Security Grade</span>
          <div className="flex items-center gap-2">
            <span
              className={`text-2xl font-black px-2 py-0.5 rounded border ${getGradeBadge(fleetStats.overallGrade)}`}
            >
              {fleetStats.overallGrade}
            </span>
            <span className="text-xs text-muted-foreground">Audited posture</span>
          </div>
          <p className="text-[11px] text-muted-foreground">From latest engine scans</p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Recorded Scans</span>
          <div className="text-2xl font-bold text-foreground">{fleetStats.totalScanned}</div>
          <p className="text-[11px] text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> {fleetStats.cleanImagesCount} clean
          </p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Critical Findings</span>
          <div
            className={`text-2xl font-bold ${fleetStats.critical > 0 ? "text-rose-400" : "text-emerald-400"}`}
          >
            {fleetStats.critical}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {fleetStats.critical === 0 ? "0 critical exposures" : "Action required"}
          </p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">High &amp; Medium</span>
          <div className="text-2xl font-bold text-foreground">
            <span className="text-orange-400">{fleetStats.high} High</span>
            <span className="text-xs text-muted-foreground ml-1.5">/ {fleetStats.medium} Med</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Runtime &amp; package checks</p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Deployment Gate</span>
          <div className="text-base font-bold text-foreground flex items-center gap-1.5 pt-1">
            <Lock className="h-4 w-4 text-emerald-400" />
            <span className="text-emerald-400 font-mono text-xs uppercase">
              {policy.blockCritical ? "Enforcing" : "Monitor"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">Max CVSS {policy.maxCvss}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search targets, scanner backend..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
            <Filter className="h-3 w-3" /> Severity:
          </span>
          {["all", "critical", "high", "medium", "clean"].map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setSelectedSeverity(filter)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer capitalize ${
                selectedSeverity === filter
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-card border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border/40 flex items-center justify-between text-xs text-muted-foreground font-medium">
          <span>Target Container &amp; Scanner Backend</span>
          <span>Findings &amp; Audit Report</span>
        </div>

        <div className="divide-y divide-border/40">
          {isLoadingScans ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Loading persisted fleet scans...
            </div>
          ) : scans.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">
                No Security Scans Recorded Yet
              </h4>
              <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
                Click &quot;Scan Fleet Now&quot; to inspect running containers via Docker Engine and
                Trivy (if available on the host).
              </p>
            </div>
          ) : filteredScans.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No scan records matched your filter.
            </div>
          ) : (
            filteredScans.map((scan) => {
              const totalFindings =
                (scan.critical || 0) + (scan.high || 0) + (scan.medium || 0) + (scan.low || 0);
              const violatesPolicy =
                (policy.blockCritical && scan.critical > 0) ||
                (policy.blockHigh && scan.high > 0);
              const grade =
                scan.critical > 0 ? "D" : scan.high > 0 ? "C" : scan.medium > 0 ? "B" : "A+";

              return (
                <div key={scan.id} className="p-5 hover:bg-muted/10 transition-colors space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center flex-wrap gap-2.5">
                        <span className="font-semibold text-sm text-foreground">{scan.target}</span>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-muted border border-border/60 text-muted-foreground">
                          {scan.scanner_backend}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded border ${getGradeBadge(grade)}`}
                        >
                          Grade {grade}
                        </span>
                        {!violatesPolicy ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                            <ShieldCheck className="h-3.5 w-3.5" /> Policy Compliant
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                            <XCircle className="h-3.5 w-3.5" /> Policy Violation
                          </span>
                        )}
                      </div>

                      <div className="flex items-center flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>{scan.summary}</span>
                        <span>·</span>
                        <span>{new Date(scan.scanned_at).toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center gap-1.5 mr-2">
                        {totalFindings === 0 ? (
                          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Clean Posture
                          </span>
                        ) : (
                          <>
                            {scan.critical > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold">
                                {scan.critical} Critical
                              </span>
                            )}
                            {scan.high > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 font-medium">
                                {scan.high} High
                              </span>
                            )}
                            {scan.medium > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
                                {scan.medium} Med
                              </span>
                            )}
                            {scan.low > 0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 font-medium">
                                {scan.low} Low
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedScanForReport(scan)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-card border border-border text-foreground hover:bg-muted transition-colors cursor-pointer"
                      >
                        <FileText className="h-3.5 w-3.5 text-primary" />
                        JSON Report
                      </button>
                    </div>
                  </div>

                  {scan.findings?.length > 0 && (
                    <div className="mt-2 space-y-2 pt-2 border-t border-border/30">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Findings &amp; Remediation
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {scan.findings.map((finding, idx) => (
                          <div
                            key={`${finding.code}-${idx}`}
                            onClick={() => setSelectedFinding(finding)}
                            className="p-3 rounded-lg bg-background border border-border/50 hover:border-border transition-colors cursor-pointer space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-foreground">
                                {finding.code}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${getSeverityBadge(finding.severity)}`}
                              >
                                {finding.severity}
                              </span>
                            </div>
                            <p className="text-xs text-foreground/90 font-medium line-clamp-1">
                              {finding.title}
                            </p>
                            <p className="text-[11px] text-emerald-400 font-mono line-clamp-1">
                              {finding.remediation}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {selectedFinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-foreground">
                  {selectedFinding.code}
                </span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded border uppercase ${getSeverityBadge(selectedFinding.severity)}`}
                >
                  {selectedFinding.severity}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFinding(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-sm font-semibold text-foreground">{selectedFinding.title}</p>
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
              <span className="text-primary font-semibold text-xs block">Remediation</span>
              <p className="text-foreground text-xs leading-relaxed">
                {selectedFinding.remediation}
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedFinding(null)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedScanForReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base">
                Security Audit Report: {selectedScanForReport.target}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedScanForReport(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>
            <div className="bg-background border border-border/50 rounded-lg p-4 font-mono text-xs whitespace-pre text-foreground/90 max-h-[50vh] overflow-y-auto">
              {JSON.stringify(selectedScanForReport, null, 2)}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(selectedScanForReport, null, 2));
                  toast.success("Copied audit report JSON");
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-muted hover:bg-muted/80 text-foreground"
              >
                <Copy className="h-3 w-3" /> Copy JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  const dataStr =
                    "data:text/json;charset=utf-8," +
                    encodeURIComponent(JSON.stringify(selectedScanForReport, null, 2));
                  const a = document.createElement("a");
                  a.setAttribute("href", dataStr);
                  a.setAttribute("download", `${selectedScanForReport.target}-security.json`);
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground"
              >
                <Download className="h-3 w-3" /> Download JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {showPolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Zero-Trust Deployment Security Gates
              </h3>
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="font-semibold text-foreground block">
                    Block on Critical Vulnerabilities
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Flags or rejects deployments when critical findings are present.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={policy.blockCritical}
                  onChange={(e) => setPolicy({ ...policy, blockCritical: e.target.checked })}
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="font-semibold text-foreground block">
                    Block on High Vulnerabilities
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Enforces strict patch hygiene on high-severity findings.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={policy.blockHigh}
                  onChange={(e) => setPolicy({ ...policy, blockHigh: e.target.checked })}
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="font-semibold text-foreground block">
                    Enforce Non-Root Container User
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Flags containers configured to run as UID 0 (root).
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={policy.enforceNonRoot}
                  onChange={(e) => setPolicy({ ...policy, enforceNonRoot: e.target.checked })}
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="font-semibold text-foreground block">
                    Require SBOM Attestation
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Requires package manifest / SBOM output before promotion.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={policy.requireSbom}
                  onChange={(e) => setPolicy({ ...policy, requireSbom: e.target.checked })}
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="font-semibold text-foreground block">Max CVSS Score</span>
                  <span className="text-muted-foreground text-[11px]">
                    Maximum allowed CVSS threshold (0.0 – 10.0).
                  </span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={policy.maxCvss}
                  onChange={(e) =>
                    setPolicy({ ...policy, maxCvss: parseFloat(e.target.value) || 0 })
                  }
                  className="w-20 px-2 py-1 rounded bg-background border border-border text-foreground font-mono text-center text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="btn-save-security-policy"
                onClick={handleSavePolicy}
                disabled={isSavingPolicy}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isSavingPolicy ? "Saving..." : "Save Policies"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
