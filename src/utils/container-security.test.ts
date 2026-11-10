import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSecurityGrade,
  evaluateSecurityPolicy,
  calculateFleetVulnerabilityStats,
  generateCycloneDxSbom,
  DEFAULT_CONTAINER_SCANS,
  DEFAULT_SECURITY_POLICY,
  type VulnerabilityItem,
  type ContainerImageScan,
  type SecurityPolicy,
} from "./container-security";

test("calculateSecurityGrade awards A+ to images with zero vulnerabilities", () => {
  const result = calculateSecurityGrade([]);
  assert.equal(result.grade, "A+");
  assert.equal(result.score, 100);
});

test("calculateSecurityGrade deducts points and grades based on severity", () => {
  const mediumVuln: VulnerabilityItem = {
    id: "CVE-2024-0001",
    packageName: "libssl",
    installedVersion: "1.1.1",
    fixedVersion: "1.1.2",
    severity: "medium",
    score: 5.0,
    title: "Sample medium",
    description: "Sample",
    cwe: "CWE-200",
    remediation: "Upgrade",
    publishedDate: "2024-01-01",
  };

  const gradeA = calculateSecurityGrade([mediumVuln]);
  assert.equal(gradeA.grade, "A");
  assert.equal(gradeA.score, 95);

  const criticalVuln: VulnerabilityItem = {
    ...mediumVuln,
    id: "CVE-2024-0002",
    severity: "critical",
    score: 9.8,
  };

  const gradeF = calculateSecurityGrade([criticalVuln, criticalVuln]);
  assert.ok(gradeF.grade === "D" || gradeF.grade === "F");
  assert.ok(gradeF.score <= 60);
});

test("evaluateSecurityPolicy passes compliant scans and flags violations", () => {
  const cleanScan: ContainerImageScan = {
    id: "scan-test",
    imageName: "nginx",
    imageTag: "alpine",
    containerName: "test-nginx",
    scannedAt: Date.now(),
    osName: "Alpine",
    totalPackages: 20,
    sbomPackageCount: 20,
    grade: "A+",
    securityScore: 100,
    status: "passed",
    vulnerabilities: [],
  };

  const cleanEval = evaluateSecurityPolicy(cleanScan, DEFAULT_SECURITY_POLICY, false, false);
  assert.equal(cleanEval.compliant, true);
  assert.equal(cleanEval.violations.length, 0);

  // Violations: run as root
  const rootEval = evaluateSecurityPolicy(cleanScan, DEFAULT_SECURITY_POLICY, true, false);
  assert.equal(rootEval.compliant, false);
  assert.ok(rootEval.violations.some((v) => v.includes("root")));

  // Violations: privileged container
  const privEval = evaluateSecurityPolicy(cleanScan, DEFAULT_SECURITY_POLICY, false, true);
  assert.equal(privEval.compliant, false);
  assert.ok(privEval.violations.some((v) => v.includes("privileged")));
});

test("evaluateSecurityPolicy blocks when critical threshold is exceeded", () => {
  const criticalVuln: VulnerabilityItem = {
    id: "CVE-2024-9999",
    packageName: "bash",
    installedVersion: "5.0",
    fixedVersion: "5.1",
    severity: "critical",
    score: 9.8,
    title: "Critical RCE",
    description: "Sample",
    cwe: "CWE-78",
    remediation: "Upgrade",
    publishedDate: "2024-01-01",
  };

  const scanWithCrit: ContainerImageScan = {
    id: "scan-crit",
    imageName: "test",
    imageTag: "1.0",
    containerName: "test",
    scannedAt: Date.now(),
    osName: "Linux",
    totalPackages: 10,
    sbomPackageCount: 10,
    grade: "F",
    securityScore: 40,
    status: "failed",
    vulnerabilities: [criticalVuln],
  };

  const policy: SecurityPolicy = {
    ...DEFAULT_SECURITY_POLICY,
    maxAllowedCritical: 0,
  };

  const res = evaluateSecurityPolicy(scanWithCrit, policy, false, false);
  assert.equal(res.compliant, false);
  assert.ok(res.violations.some((v) => v.includes("critical")));
});

const testScans: ContainerImageScan[] = [
  {
    id: "scan-1",
    imageName: "caddy",
    imageTag: "2.8-alpine",
    containerName: "caddy_edge",
    scannedAt: Date.now(),
    osName: "Alpine Linux",
    totalPackages: 18,
    sbomPackageCount: 18,
    grade: "A+",
    securityScore: 100,
    status: "passed",
    vulnerabilities: [],
  },
  {
    id: "scan-2",
    imageName: "postgres",
    imageTag: "16-alpine",
    containerName: "pg_db",
    scannedAt: Date.now(),
    osName: "Alpine Linux",
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
        title: "Test CVE",
        description: "Test description",
        cwe: "CWE-200",
        remediation: "Upgrade",
        publishedDate: "2024-05-09",
      },
    ],
  },
  {
    id: "scan-3",
    imageName: "node",
    imageTag: "18-slim",
    containerName: "api",
    scannedAt: Date.now(),
    osName: "Debian",
    totalPackages: 80,
    sbomPackageCount: 80,
    grade: "B",
    securityScore: 78,
    status: "warning",
    vulnerabilities: [
      {
        id: "CVE-2024-21626",
        packageName: "runc",
        installedVersion: "1.1.10",
        fixedVersion: "1.1.11",
        severity: "high",
        score: 8.6,
        title: "Test high CVE",
        description: "Test description",
        cwe: "CWE-403",
        remediation: "Upgrade",
        publishedDate: "2024-01-31",
      },
    ],
  },
];

test("calculateFleetVulnerabilityStats computes accurate fleet totals", () => {
  const stats = calculateFleetVulnerabilityStats(testScans);
  assert.equal(stats.totalScanned, 3);
  assert.equal(stats.totalVulnerabilities, 2);
  assert.equal(stats.cleanImagesCount, 1);
  assert.equal(stats.high, 1);
  assert.equal(stats.medium, 1);
});

test("generateCycloneDxSbom generates valid CycloneDX 1.5 JSON", () => {
  const scan = testScans[1]; // Postgres
  const sbomRaw = generateCycloneDxSbom(scan);
  assert.ok(sbomRaw.length > 50);

  const parsed = JSON.parse(sbomRaw);
  assert.equal(parsed.bomFormat, "CycloneDX");
  assert.equal(parsed.specVersion, "1.5");
  assert.equal(parsed.metadata.component.name, "postgres");
  assert.equal(parsed.components.length, 1);
  assert.equal(parsed.vulnerabilities.length, 1);
  assert.equal(parsed.vulnerabilities[0].id, "CVE-2024-4317");
});

test("DEFAULT_CONTAINER_SCANS is an initialized array and DEFAULT_SECURITY_POLICY is valid", () => {
  assert.ok(Array.isArray(DEFAULT_CONTAINER_SCANS));
  assert.ok(DEFAULT_SECURITY_POLICY.id.length > 0);
  assert.equal(DEFAULT_SECURITY_POLICY.maxAllowedCritical, 0);
  assert.equal(DEFAULT_SECURITY_POLICY.disallowRootUser, true);
});
