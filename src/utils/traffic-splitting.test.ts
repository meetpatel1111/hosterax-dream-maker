import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCaddyTrafficSplitSnippet,
  generateNginxTrafficSplitSnippet,
  evaluateCanaryHealth,
  calculateTrafficDistribution,
  PRESET_ROLLOUT_STRATEGIES,
  type HealthProbeResult,
} from "./traffic-splitting";

test("generateCaddyTrafficSplitSnippet generates correct 10% canary configuration", () => {
  const config = generateCaddyTrafficSplitSnippet({
    domain: "api.example.com",
    stablePort: 3000,
    canaryPort: 3001,
    canaryWeightPercent: 10,
    headerOverride: "X-Canary",
  });

  assert.ok(config.includes("api.example.com {"));
  assert.ok(config.includes('@canaryHeader header X-Canary "true"'));
  assert.ok(config.includes("reverse_proxy 127.0.0.1:3001"));
  assert.ok(config.includes("to 127.0.0.1:3000 127.0.0.1:3001"));
  assert.ok(config.includes("lb_policy round_robin"));
});

test("generateCaddyTrafficSplitSnippet handles 0% and 100% boundary weights", () => {
  const zeroCanary = generateCaddyTrafficSplitSnippet({
    domain: "api.example.com",
    stablePort: 3000,
    canaryPort: 3001,
    canaryWeightPercent: 0,
  });
  assert.ok(zeroCanary.includes("100% Stable Traffic"));
  assert.ok(zeroCanary.includes("reverse_proxy 127.0.0.1:3000"));

  const fullCanary = generateCaddyTrafficSplitSnippet({
    domain: "api.example.com",
    stablePort: 3000,
    canaryPort: 3001,
    canaryWeightPercent: 100,
  });
  assert.ok(fullCanary.includes("100% Canary Rollout Promoted"));
  assert.ok(fullCanary.includes("reverse_proxy 127.0.0.1:3001"));
});

test("generateNginxTrafficSplitSnippet generates split_clients block", () => {
  const nginxConfig = generateNginxTrafficSplitSnippet({
    domain: "api.example.com",
    stablePort: 3000,
    canaryPort: 3001,
    canaryWeightPercent: 20,
    stickyCookie: true,
  });

  assert.ok(nginxConfig.includes("upstream upstream_stable_3000"));
  assert.ok(nginxConfig.includes("upstream upstream_canary_3001"));
  assert.ok(nginxConfig.includes('split_clients "$remote_addr$http_user_agent"'));
  assert.ok(nginxConfig.includes("20% upstream_canary_3001;"));
  assert.ok(nginxConfig.includes("proxy_pass http://$app_upstream_3000;"));
});

test("evaluateCanaryHealth returns promote when probes are consistently healthy", () => {
  const healthyProbes: HealthProbeResult[] = Array.from({ length: 12 }, (_, i) => ({
    statusCode: 200,
    latencyMs: 45 + (i % 5),
    timestamp: Date.now() - i * 1000,
    endpoint: "/healthz",
  }));

  const result = evaluateCanaryHealth(healthyProbes);
  assert.equal(result.healthy, true);
  assert.equal(result.successRate, 100);
  assert.equal(result.recommendation, "promote");
  assert.ok(result.details.includes("EXCELLENT"));
});

test("evaluateCanaryHealth flags rollback on high error rates or high latency", () => {
  const failingProbes: HealthProbeResult[] = [
    { statusCode: 200, latencyMs: 50, timestamp: 1, endpoint: "/healthz" },
    { statusCode: 500, latencyMs: 900, timestamp: 2, endpoint: "/healthz" },
    { statusCode: 502, latencyMs: 1200, timestamp: 3, endpoint: "/healthz" },
  ];

  const result = evaluateCanaryHealth(failingProbes);
  assert.equal(result.healthy, false);
  assert.equal(result.recommendation, "rollback");
  assert.ok(result.details.includes("ALERT"));
});

test("calculateTrafficDistribution accurately apportions requests", () => {
  const { stableRequests, canaryRequests } = calculateTrafficDistribution(10000, 15);
  assert.equal(canaryRequests, 1500);
  assert.equal(stableRequests, 8500);

  const zero = calculateTrafficDistribution(5000, 0);
  assert.equal(zero.canaryRequests, 0);
  assert.equal(zero.stableRequests, 5000);
});

test("PRESET_ROLLOUT_STRATEGIES are all defined with valid parameters", () => {
  assert.ok(PRESET_ROLLOUT_STRATEGIES.length >= 4);
  assert.ok(PRESET_ROLLOUT_STRATEGIES.some((s) => s.id === "conservative-canary"));
  assert.ok(PRESET_ROLLOUT_STRATEGIES.some((s) => s.id === "fast-blue-green"));
});
