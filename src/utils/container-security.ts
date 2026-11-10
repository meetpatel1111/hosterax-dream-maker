// src/utils/container-security.ts
// Pure utility library for HosteraX Container Fleet Security,
// CVE Vulnerability Scanning, SBOM (CycloneDX) Generation, and Security Policy Gates.

export type CveSeverity = "critical" | "high" | "medium" | "low";

export interface VulnerabilityItem {
  id: string; // e.g. CVE-2024-21626
  packageName: string;
  installedVersion: string;
  fixedVersion: string;
  severity: CveSeverity;
  score: number; // CVSS 0.0 - 10.0
  title: string;
  description: string;
  cwe: string; // e.g. CWE-78
  remediation: string;
  publishedDate: string;
}

export interface ContainerImageScan {
  id: string;
  imageName: string;
  imageTag: string;
  containerName: string;
  scannedAt: number;
  osName: string;
  totalPackages: number;
  vulnerabilities: VulnerabilityItem[];
  securityScore: number; // 0 - 100
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  status: "passed" | "warning" | "failed";
  sbomPackageCount: number;
}

export interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  blockDeploymentsOnFail: boolean;
  maxAllowedCritical: number;
  maxAllowedHigh: number;
  disallowRootUser: boolean;
  disallowPrivilegedMode: boolean;
  requireReadOnlyRootFs: boolean;
}

/**
 * Calculates a letter grade based on vulnerability count and maximum severity.
 */
export function calculateSecurityGrade(vulnerabilities: VulnerabilityItem[]): {
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  score: number;
} {
  const criticalCount = vulnerabilities.filter((v) => v.severity === "critical").length;
  const highCount = vulnerabilities.filter((v) => v.severity === "high").length;
  const mediumCount = vulnerabilities.filter((v) => v.severity === "medium").length;
  const lowCount = vulnerabilities.filter((v) => v.severity === "low").length;

  const deduction = criticalCount * 25 + highCount * 12 + mediumCount * 5 + lowCount * 1;
  let score = Math.max(0, 100 - deduction);

  let grade: "A+" | "A" | "B" | "C" | "D" | "F" = "F";
  if (criticalCount > 0) {
    grade = score > 60 ? "D" : "F";
  } else if (highCount > 2) {
    grade = "C";
  } else if (highCount > 0 || mediumCount > 3) {
    grade = "B";
  } else if (mediumCount > 0 || lowCount > 0) {
    grade = "A";
  } else {
    grade = "A+";
    score = 100;
  }

  return { grade, score };
}

/**
 * Evaluates whether an image scan complies with an active security policy.
 */
export function evaluateSecurityPolicy(
  scan: ContainerImageScan,
  policy: SecurityPolicy,
  isRootUser: boolean = false,
  isPrivileged: boolean = false,
): { compliant: boolean; violations: string[] } {
  const violations: string[] = [];

  const criticals = scan.vulnerabilities.filter((v) => v.severity === "critical").length;
  const highs = scan.vulnerabilities.filter((v) => v.severity === "high").length;

  if (criticals > policy.maxAllowedCritical) {
    violations.push(
      `Exceeded max allowed critical vulnerabilities (${criticals} found, max allowed: ${policy.maxAllowedCritical}).`,
    );
  }

  if (highs > policy.maxAllowedHigh) {
    violations.push(
      `Exceeded max allowed high vulnerabilities (${highs} found, max allowed: ${policy.maxAllowedHigh}).`,
    );
  }

  if (policy.disallowRootUser && isRootUser) {
    violations.push("Container runs as root (UID 0), violating non-root execution policy.");
  }

  if (policy.disallowPrivilegedMode && isPrivileged) {
    violations.push(
      "Container runs in privileged mode, violating least-privilege security policy.",
    );
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}

/**
 * Computes fleet-wide CVE statistics.
 */
export function calculateFleetVulnerabilityStats(scans: ContainerImageScan[]): {
  totalScanned: number;
  totalVulnerabilities: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  overallGrade: "A+" | "A" | "B" | "C" | "D" | "F";
  cleanImagesCount: number;
} {
  const totalScanned = scans.length;
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let cleanImagesCount = 0;

  for (const scan of scans) {
    const crits = scan.vulnerabilities.filter((v) => v.severity === "critical").length;
    const highs = scan.vulnerabilities.filter((v) => v.severity === "high").length;
    const meds = scan.vulnerabilities.filter((v) => v.severity === "medium").length;
    const lows = scan.vulnerabilities.filter((v) => v.severity === "low").length;

    critical += crits;
    high += highs;
    medium += meds;
    low += lows;

    if (scan.vulnerabilities.length === 0) {
      cleanImagesCount++;
    }
  }

  const allVulns = scans.flatMap((s) => s.vulnerabilities);
  const { grade: overallGrade } = calculateSecurityGrade(allVulns);

  return {
    totalScanned,
    totalVulnerabilities: critical + high + medium + low,
    critical,
    high,
    medium,
    low,
    overallGrade,
    cleanImagesCount,
  };
}

/**
 * Generates an industry-standard CycloneDX JSON Software Bill of Materials (SBOM).
 */
export function generateCycloneDxSbom(scan: ContainerImageScan): string {
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${scan.id}-sbom`,
    version: 1,
    metadata: {
      timestamp: new Date(scan.scannedAt).toISOString(),
      component: {
        type: "container",
        name: scan.imageName,
        version: scan.imageTag,
        properties: [
          { name: "hosterax:container", value: scan.containerName },
          { name: "hosterax:os", value: scan.osName },
          { name: "hosterax:security_grade", value: scan.grade },
        ],
      },
    },
    components: scan.vulnerabilities.map((v) => ({
      type: "library",
      name: v.packageName,
      version: v.installedVersion,
      purl: `pkg:deb/${v.packageName}@${v.installedVersion}`,
      properties: [{ name: "cve:fixed_version", value: v.fixedVersion }],
    })),
    vulnerabilities: scan.vulnerabilities.map((v) => ({
      id: v.id,
      source: { name: "NVD", url: `https://nvd.nist.gov/vuln/detail/${v.id}` },
      ratings: [
        {
          source: { name: "NVD" },
          score: v.score,
          severity: v.severity.toUpperCase(),
          method: "CVSSv31",
        },
      ],
      description: v.description,
      recommendation: v.remediation,
    })),
  };

  return JSON.stringify(sbom, null, 2);
}

/**
 * Container scan registry starts empty until real containers are discovered and scanned.
 */
export const DEFAULT_CONTAINER_SCANS: ContainerImageScan[] = [];

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  id: "pol-prod-default",
  name: "HosteraX Enterprise Zero-Trust Policy",
  description:
    "Strict deployment gate blocking critical CVEs, root user containers, and unconfined privileges.",
  enabled: true,
  blockDeploymentsOnFail: true,
  maxAllowedCritical: 0,
  maxAllowedHigh: 2,
  disallowRootUser: true,
  disallowPrivilegedMode: true,
  requireReadOnlyRootFs: false,
};
