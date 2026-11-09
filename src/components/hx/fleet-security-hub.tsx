import { useState, useMemo } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  FileText,
  Download,
  Copy,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  SlidersHorizontal,
  ExternalLink,
  Code,
  Lock,
  Layers,
  ArrowUpRight,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_CONTAINER_SCANS,
  DEFAULT_SECURITY_POLICY,
  calculateFleetVulnerabilityStats,
  calculateSecurityGrade,
  evaluateSecurityPolicy,
  generateCycloneDxSbom,
  type ContainerImageScan,
  type VulnerabilityItem,
  type SecurityPolicy,
  type CveSeverity,
} from "../../utils/container-security";

export function FleetSecurityHub() {
  const [scans, setScans] = useState<ContainerImageScan[]>(DEFAULT_CONTAINER_SCANS);
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_SECURITY_POLICY);
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [selectedScanForSbom, setSelectedScanForSbom] = useState<ContainerImageScan | null>(null);
  const [selectedVulnerability, setSelectedVulnerability] = useState<VulnerabilityItem | null>(
    null,
  );
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  // Fleet stats
  const fleetStats = useMemo(() => calculateFleetVulnerabilityStats(scans), [scans]);

  // Filtered scans
  const filteredScans = useMemo(() => {
    return scans.filter((scan) => {
      const matchesSearch =
        scan.imageName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        scan.containerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        scan.osName.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (selectedSeverity === "all") return true;
      if (selectedSeverity === "clean") return scan.vulnerabilities.length === 0;
      return scan.vulnerabilities.some((v) => v.severity === selectedSeverity);
    });
  }, [scans, searchQuery, selectedSeverity]);

  // Trigger fleet rescan
  const handleRescanFleet = () => {
    setIsScanning(true);
    toast.info("Triggering vulnerability engine scan across running container images...");
    setTimeout(() => {
      setScans((prev) =>
        prev.map((scan) => {
          const { grade, score } = calculateSecurityGrade(scan.vulnerabilities);
          return {
            ...scan,
            scannedAt: Date.now(),
            securityScore: score,
            grade,
            status: score >= 90 ? "passed" : score >= 70 ? "warning" : "failed",
          };
        }),
      );
      setIsScanning(false);
      toast.success("Fleet security scan completed! Vulnerability database synchronized.");
    }, 800);
  };

  // Severity badge helper
  const getSeverityBadge = (severity: CveSeverity) => {
    switch (severity) {
      case "critical":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      case "high":
        return "bg-orange-500/10 text-orange-400 border-orange-500/20";
      case "medium":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "low":
        return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    }
  };

  // Grade badge helper
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <ShieldAlert className="h-6 w-6 text-primary" />
              Container Security & CVE Defense Hub
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 border border-primary/20 text-primary">
              <Lock className="h-3 w-3" />
              Zero-Trust Gating
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Automated container image vulnerability scanning, CycloneDX Software Bill of Materials
            (SBOM), and deployment security policy enforcement.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowPolicyModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            Policy Gates ({policy.enabled ? "Active" : "Disabled"})
          </button>

          <button
            onClick={handleRescanFleet}
            disabled={isScanning}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? "animate-spin" : ""}`} />
            Scan Fleet Now
          </button>
        </div>
      </div>

      {/* Fleet Posture Banner */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Fleet Security Grade</span>
          <div className="flex items-center gap-2">
            <span
              className={`text-2xl font-black px-2 py-0.5 rounded border ${getGradeBadge(fleetStats.overallGrade)}`}
            >
              {fleetStats.overallGrade}
            </span>
            <span className="text-xs text-muted-foreground">Overall posture</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Based on worst CVE severity</p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Scanned Images</span>
          <div className="text-2xl font-bold text-foreground">{fleetStats.totalScanned} Images</div>
          <p className="text-[11px] text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> {fleetStats.cleanImagesCount} 100% clean
          </p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Critical CVEs</span>
          <div
            className={`text-2xl font-bold ${fleetStats.critical > 0 ? "text-rose-400" : "text-emerald-400"}`}
          >
            {fleetStats.critical}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {fleetStats.critical === 0 ? "0 blocking deployment gates" : "Action required"}
          </p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">High & Medium CVEs</span>
          <div className="text-2xl font-bold text-foreground">
            <span className="text-orange-400">{fleetStats.high} High</span>
            <span className="text-xs text-muted-foreground ml-1.5">/ {fleetStats.medium} Med</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Base image patches available</p>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-1">
          <span className="text-xs text-muted-foreground font-medium">Deployment Gate</span>
          <div className="text-base font-bold text-foreground flex items-center gap-1.5 pt-1">
            <Lock className="h-4 w-4 text-emerald-400" />
            <span className="text-emerald-400 font-mono text-xs uppercase">Enforcing</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Zero Critical CVEs allowed</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search images, containers, OS..."
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

      {/* Scanned Images Table */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border/40 flex items-center justify-between text-xs text-muted-foreground font-medium">
          <span>Target Container & Image</span>
          <span>Security Posture & Actions</span>
        </div>

        <div className="divide-y divide-border/40">
          {filteredScans.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No container images matched your search criteria.
            </div>
          ) : (
            filteredScans.map((scan) => {
              const evalResult = evaluateSecurityPolicy(scan, policy);

              return (
                <div key={scan.id} className="p-5 hover:bg-muted/10 transition-colors space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Container and Image info */}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-sm text-foreground">
                          {scan.imageName}:{scan.imageTag}
                        </span>
                        <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-muted border border-border/60 text-muted-foreground">
                          {scan.containerName}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded border ${getGradeBadge(scan.grade)}`}
                        >
                          Grade {scan.grade}
                        </span>
                        {evalResult.compliant ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                            <ShieldCheck className="h-3.5 w-3.5" /> Policy Compliant
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                            <XCircle className="h-3.5 w-3.5" /> Policy Violation
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>OS: {scan.osName}</span>
                        <span>·</span>
                        <span>{scan.totalPackages} Packages Analyzed</span>
                        <span>·</span>
                        <span>
                          Scanned{" "}
                          {new Date(scan.scannedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Right: Vulnerability breakdown & SBOM buttons */}
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center gap-1.5 mr-2">
                        {scan.vulnerabilities.length === 0 ? (
                          <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Zero Known CVEs
                          </span>
                        ) : (
                          <>
                            {scan.vulnerabilities.filter((v) => v.severity === "critical").length >
                              0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 font-bold">
                                {
                                  scan.vulnerabilities.filter((v) => v.severity === "critical")
                                    .length
                                }{" "}
                                Critical
                              </span>
                            )}
                            {scan.vulnerabilities.filter((v) => v.severity === "high").length >
                              0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 font-medium">
                                {scan.vulnerabilities.filter((v) => v.severity === "high").length}{" "}
                                High
                              </span>
                            )}
                            {scan.vulnerabilities.filter((v) => v.severity === "medium").length >
                              0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
                                {scan.vulnerabilities.filter((v) => v.severity === "medium").length}{" "}
                                Med
                              </span>
                            )}
                            {scan.vulnerabilities.filter((v) => v.severity === "low").length >
                              0 && (
                              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 font-medium">
                                {scan.vulnerabilities.filter((v) => v.severity === "low").length}{" "}
                                Low
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      <button
                        onClick={() => setSelectedScanForSbom(scan)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-card border border-border text-foreground hover:bg-muted transition-colors cursor-pointer"
                      >
                        <FileText className="h-3.5 w-3.5 text-primary" />
                        CycloneDX SBOM
                      </button>
                    </div>
                  </div>

                  {/* Vulnerabilities Detail List */}
                  {scan.vulnerabilities.length > 0 && (
                    <div className="mt-2 space-y-2 pt-2 border-t border-border/30">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Detected CVEs & Remediation
                      </span>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {scan.vulnerabilities.map((vuln) => (
                          <div
                            key={vuln.id}
                            onClick={() => setSelectedVulnerability(vuln)}
                            className="p-3 rounded-lg bg-background border border-border/50 hover:border-border transition-colors cursor-pointer space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-bold text-foreground flex items-center gap-1">
                                {vuln.id}
                                <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${getSeverityBadge(vuln.severity)}`}
                              >
                                {vuln.severity} ({vuln.score})
                              </span>
                            </div>
                            <p className="text-xs text-foreground/90 font-medium line-clamp-1">
                              {vuln.title}
                            </p>
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                              <span className="font-mono">{vuln.packageName}</span>
                              <span className="text-emerald-400 font-mono">
                                Fixed: {vuln.fixedVersion}
                              </span>
                            </div>
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

      {/* Modal: CVE Vulnerability Details */}
      {selectedVulnerability && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-foreground">
                  {selectedVulnerability.id}
                </span>
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded border uppercase ${getSeverityBadge(selectedVulnerability.severity)}`}
                >
                  CVSS {selectedVulnerability.score} ({selectedVulnerability.severity})
                </span>
              </div>
              <button
                onClick={() => setSelectedVulnerability(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <h4 className="font-semibold text-foreground text-sm">
                  {selectedVulnerability.title}
                </h4>
                <p className="text-muted-foreground mt-1 leading-relaxed">
                  {selectedVulnerability.description}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Affected Package</span>
                  <span className="font-mono font-bold text-foreground">
                    {selectedVulnerability.packageName}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">CWE Taxonomy</span>
                  <span className="font-mono font-bold text-foreground">
                    {selectedVulnerability.cwe}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Installed Version</span>
                  <span className="font-mono text-rose-400">
                    {selectedVulnerability.installedVersion}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[11px]">Fixed In Version</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {selectedVulnerability.fixedVersion}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
                <span className="text-primary font-semibold text-xs block">Remediation Action</span>
                <p className="text-foreground text-xs leading-relaxed">
                  {selectedVulnerability.remediation}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <a
                href={`https://nvd.nist.gov/vuln/detail/${selectedVulnerability.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
              >
                <ExternalLink className="h-3 w-3" /> View in NIST NVD
              </a>
              <button
                onClick={() => setSelectedVulnerability(null)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-card border border-border text-foreground hover:bg-muted"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: CycloneDX SBOM Viewer */}
      {selectedScanForSbom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h3 className="font-bold text-foreground text-base">
                  CycloneDX SBOM: {selectedScanForSbom.imageName}:{selectedScanForSbom.imageTag}
                </h3>
              </div>
              <button
                onClick={() => setSelectedScanForSbom(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground text-sm"
              >
                ✕
              </button>
            </div>

            <div className="bg-background border border-border/50 rounded-lg p-4 font-mono text-xs whitespace-pre text-foreground/90 max-h-[50vh] overflow-y-auto">
              {generateCycloneDxSbom(selectedScanForSbom)}
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-muted-foreground">
                CycloneDX v1.5 specification compliant.
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generateCycloneDxSbom(selectedScanForSbom));
                    toast.success("CycloneDX JSON copied to clipboard!");
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-muted hover:bg-muted/80 text-foreground transition-colors"
                >
                  <Copy className="h-3 w-3" /> Copy JSON
                </button>
                <button
                  onClick={() => {
                    const dataStr =
                      "data:text/json;charset=utf-8," +
                      encodeURIComponent(generateCycloneDxSbom(selectedScanForSbom));
                    const downloadAnchor = document.createElement("a");
                    downloadAnchor.setAttribute("href", dataStr);
                    downloadAnchor.setAttribute(
                      "download",
                      `${selectedScanForSbom.imageName}-sbom.json`,
                    );
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    downloadAnchor.remove();
                    toast.success("Downloaded SBOM JSON!");
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Download className="h-3 w-3" /> Download JSON
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Security Policy Gates */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Zero-Trust Deployment Security Gates
              </h3>
              <button
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
                    Block Deployments on Critical CVEs
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Rejects docker image builds with CVSS &gt;= 9.0 vulnerabilities.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={policy.blockDeploymentsOnFail}
                  onChange={(e) =>
                    setPolicy({ ...policy, blockDeploymentsOnFail: e.target.checked })
                  }
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="font-semibold text-foreground block">
                    Enforce Non-Root Execution
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Requires containers to run as non-root user (USER != 0).
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={policy.disallowRootUser}
                  onChange={(e) => setPolicy({ ...policy, disallowRootUser: e.target.checked })}
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="font-semibold text-foreground block">
                    Disallow Privileged Containers
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Blocks --privileged flag to enforce container namespace isolation.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={policy.disallowPrivilegedMode}
                  onChange={(e) =>
                    setPolicy({ ...policy, disallowPrivilegedMode: e.target.checked })
                  }
                  className="h-4 w-4 rounded accent-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-background border border-border/40">
                <div>
                  <span className="font-semibold text-foreground block">
                    Max Allowed High Severity CVEs
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    Threshold before warning or rejection.
                  </span>
                </div>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={policy.maxAllowedHigh}
                  onChange={(e) =>
                    setPolicy({ ...policy, maxAllowedHigh: parseInt(e.target.value) || 0 })
                  }
                  className="w-16 px-2 py-1 rounded bg-background border border-border text-foreground font-mono text-center text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
              <button
                onClick={() => {
                  setShowPolicyModal(false);
                  toast.success("Security policy updated and active across deployment pipelines.");
                }}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Save Policies
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
