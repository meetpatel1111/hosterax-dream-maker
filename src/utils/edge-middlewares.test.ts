import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCaddySnippet,
  generateNginxSnippet,
  testMiddlewareEvaluation,
  decodeBase64,
  PRESET_MIDDLEWARES,
  type EdgeMiddleware,
} from "./edge-middlewares";

test("generateCaddySnippet produces correct directives for all middleware types", () => {
  const basicAuth: EdgeMiddleware = {
    id: "1",
    name: "auth",
    description: "test",
    type: "basic-auth",
    enabled: true,
    attachedDomains: [],
    config: { username: "user", password: "pwd" },
  };
  const caddyAuth = generateCaddySnippet(basicAuth);
  assert.match(caddyAuth, /basicauth \{/);
  assert.match(caddyAuth, /user pwd/);

  const rateLimit: EdgeMiddleware = {
    id: "2",
    name: "limiter",
    description: "test",
    type: "rate-limit",
    enabled: true,
    attachedDomains: [],
    config: { requestsPerMinute: 60, burst: 10, keyBy: "ip" },
  };
  const caddyLimit = generateCaddySnippet(rateLimit);
  assert.match(caddyLimit, /rate_limit \{/);
  assert.match(caddyLimit, /events 60/);

  const ipWhitelist: EdgeMiddleware = {
    id: "3",
    name: "ip",
    description: "test",
    type: "ip-whitelist",
    enabled: true,
    attachedDomains: [],
    config: { allowedIps: ["10.0.0.1", "192.168.1.0/24"] },
  };
  const caddyIp = generateCaddySnippet(ipWhitelist);
  assert.match(caddyIp, /@blocked not remote_ip 10\.0\.0\.1 192\.168\.1\.0\/24/);
  assert.match(caddyIp, /abort @blocked/);

  const secHeaders: EdgeMiddleware = {
    id: "4",
    name: "headers",
    description: "test",
    type: "security-headers",
    enabled: true,
    attachedDomains: [],
    config: { hsts: true, frameOptions: "DENY", contentTypeOptions: true },
  };
  const caddyHeaders = generateCaddySnippet(secHeaders);
  assert.match(caddyHeaders, /Strict-Transport-Security/);
  assert.match(caddyHeaders, /X-Frame-Options "DENY"/);
  assert.match(caddyHeaders, /X-Content-Type-Options "nosniff"/);
});

test("generateNginxSnippet produces correct directives for OpenResty", () => {
  const ipWhitelist: EdgeMiddleware = {
    id: "1",
    name: "ip",
    description: "test",
    type: "ip-whitelist",
    enabled: true,
    attachedDomains: [],
    config: { allowedIps: ["127.0.0.1", "10.0.0.0/8"] },
  };
  const nginxIp = generateNginxSnippet(ipWhitelist);
  assert.match(nginxIp, /allow 127\.0\.0\.1;/);
  assert.match(nginxIp, /allow 10\.0\.0\.0\/8;/);
  assert.match(nginxIp, /deny all;/);

  const bodyLimit: EdgeMiddleware = {
    id: "2",
    name: "upload",
    description: "test",
    type: "body-limit",
    enabled: true,
    attachedDomains: [],
    config: { maxBodyMegabytes: 150 },
  };
  const nginxLimit = generateNginxSnippet(bodyLimit);
  assert.match(nginxLimit, /client_max_body_size 150M;/);
});

test("testMiddlewareEvaluation validates IP whitelist", () => {
  const mw: EdgeMiddleware = {
    id: "1",
    name: "vpn",
    description: "test",
    type: "ip-whitelist",
    enabled: true,
    attachedDomains: [],
    config: { allowedIps: ["10.0.0.0/8", "127.0.0.1"] },
  };

  // Allowed loopback IP
  const res1 = testMiddlewareEvaluation(mw, {
    ip: "127.0.0.1",
    path: "/dashboard",
    method: "GET",
    headers: {},
  });
  assert.equal(res1.allowed, true);
  assert.equal(res1.statusCode, 200);

  // Allowed 10.x.x.x CIDR
  const res2 = testMiddlewareEvaluation(mw, {
    ip: "10.0.4.55",
    path: "/dashboard",
    method: "GET",
    headers: {},
  });
  assert.equal(res2.allowed, true);
  assert.equal(res2.statusCode, 200);

  // Blocked external IP
  const res3 = testMiddlewareEvaluation(mw, {
    ip: "198.51.100.22",
    path: "/dashboard",
    method: "GET",
    headers: {},
  });
  assert.equal(res3.allowed, false);
  assert.equal(res3.statusCode, 403);
});

test("testMiddlewareEvaluation validates Basic Auth credentials", () => {
  const mw: EdgeMiddleware = {
    id: "1",
    name: "auth",
    description: "test",
    type: "basic-auth",
    enabled: true,
    attachedDomains: [],
    config: { username: "admin", password: "secretPassword" },
  };

  // Missing Authorization header
  const res1 = testMiddlewareEvaluation(mw, {
    ip: "1.2.3.4",
    path: "/",
    method: "GET",
    headers: {},
  });
  assert.equal(res1.allowed, false);
  assert.equal(res1.statusCode, 401);
  assert.ok(res1.injectedHeaders["WWW-Authenticate"]);

  // Valid credentials: base64(admin:secretPassword) = YWRtaW46c2VjcmV0UGFzc3dvcmQ=
  const validToken = Buffer.from("admin:secretPassword").toString("base64");
  const res2 = testMiddlewareEvaluation(mw, {
    ip: "1.2.3.4",
    path: "/",
    method: "GET",
    headers: { authorization: `Basic ${validToken}` },
  });
  assert.equal(res2.allowed, true);
  assert.equal(res2.statusCode, 200);

  // Wrong password
  const badToken = Buffer.from("admin:wrong").toString("base64");
  const res3 = testMiddlewareEvaluation(mw, {
    ip: "1.2.3.4",
    path: "/",
    method: "GET",
    headers: { authorization: `Basic ${badToken}` },
  });
  assert.equal(res3.allowed, false);
  assert.equal(res3.statusCode, 401);
});

test("all PRESET_MIDDLEWARES generate non-empty Caddy and Nginx configs", () => {
  assert.ok(PRESET_MIDDLEWARES.length >= 5);
  for (const preset of PRESET_MIDDLEWARES) {
    const caddy = generateCaddySnippet(preset);
    const nginx = generateNginxSnippet(preset);
    assert.ok(caddy.length > 20, `Caddy snippet empty for ${preset.name}`);
    assert.ok(nginx.length > 20, `Nginx snippet empty for ${preset.name}`);
  }
});

test("decodeBase64 handles standard base64 decoding correctly", () => {
  const encoded = Buffer.from("admin:hosterax-staging-2026").toString("base64");
  assert.equal(decodeBase64(encoded), "admin:hosterax-staging-2026");
});
