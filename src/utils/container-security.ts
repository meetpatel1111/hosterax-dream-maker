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
 * Curated real-world CVE vulnerability database for preset Docker containers.
 */
export const DEFAULT_CONTAINER_SCANS: ContainerImageScan[] = [
  {
    id: "scan-edge",
    imageName: "caddy",
    imageTag: "2.8.4-alpine",
    containerName: "hx_edge",
    scannedAt: Date.now() - 3600000,
    osName: "Alpine Linux 3.20",
    totalPackages: 18,
    sbomPackageCount: 18,
    grade: "A+",
    securityScore: 100,
    status: "passed",
    vulnerabilities: [],
  },
  {
    id: "scan-postgres",
    imageName: "postgres",
    imageTag: "16.3-alpine",
    containerName: "hx_postgres_cluster",
    scannedAt: Date.now() - 7200000,
    osName: "Alpine Linux 3.20",
    totalPackages: 42,
    sbomPackageCount: 42,
    grade: "A",
    securityScore: 94,
    status: "passed",
    vulnerabilities: [
      {
        id: "CVE-2024-4317",
        packageName: "postgresql-common",
        installedVersion: "16.3-r0",
        fixedVersion: "16.4-r0",
        severity: "medium",
        score: 5.3,
        title: "Information disclosure via memory cache race",
        description:
          "PostgreSQL pg_stats view visibility race condition under concurrent query execution.",
        cwe: "CWE-200",
        remediation: "Upgrade postgres image tag to 16.4-alpine or higher.",
        publishedDate: "2024-05-09",
      },
    ],
  },
  {
    id: "scan-redis",
    imageName: "redis",
    imageTag: "7.2.4-alpine",
    containerName: "hx_redis_cache",
    scannedAt: Date.now() - 14400000,
    osName: "Alpine Linux 3.19",
    totalPackages: 24,
    sbomPackageCount: 24,
    grade: "A+",
    securityScore: 100,
    status: "passed",
    vulnerabilities: [],
  },
  {
    id: "scan-app-backend",
    imageName: "node",
    imageTag: "18.19-bullseye-slim",
    containerName: "hx_api_backend",
    scannedAt: Date.now() - 21600000,
    osName: "Debian GNU/Linux 11 (bullseye)",
    totalPackages: 112,
    sbomPackageCount: 112,
    grade: "B",
    securityScore: 78,
    status: "warning",
    vulnerabilities: [
      {
        id: "CVE-2024-21626",
        packageName: "runc",
        installedVersion: "1.1.10-0ubuntu1",
        fixedVersion: "1.1.11-0ubuntu1",
        severity: "high",
        score: 8.6,
        title: "runc container breakout via leaked file descriptors",
        description:
          "A vulnerability in runc allows container processes to escape containment through inherited file descriptors.",
        cwe: "CWE-403",
        remediation: "Update base image or upgrade runc to version >= 1.1.11.",
        publishedDate: "2024-01-31",
      },
      {
        id: "CVE-2024-24790",
        packageName: "golang.org/x/net",
        installedVersion: "v0.20.0",
        fixedVersion: "v0.23.0",
        severity: "medium",
        score: 6.5,
        title: "HTTP/2 continuous CONTINUATION frames DoS",
        description:
          "The HTTP/2 protocol allows a client to trigger excessive CPU utilization by streaming unclosed header frames.",
        cwe: "CWE-400",
        remediation: "Rebuild application bundle with Go runtime >= 1.22.2.",
        publishedDate: "2024-04-04",
      },
      {
        id: "CVE-2023-45853",
        packageName: "zlib",
        installedVersion: "1:1.2.11.dfsg-2+deb11u2",
        fixedVersion: "1:1.2.11.dfsg-2+deb11u3",
        severity: "low",
        score: 3.3,
        title: "Integer overflow in MiniZip",
        description: "Buffer overflow vulnerability in MiniZip zipOpenNewFileInZip4_64 function.",
        cwe: "CWE-190",
        remediation: "Run apt-get update && apt-get install --only-upgrade zlib1g.",
        publishedDate: "2023-10-14",
      },
    ],
  },
];

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
