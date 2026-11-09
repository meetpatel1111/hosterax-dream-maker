import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDotEnv,
  exportToDotEnv,
  interpolateVariables,
  generateSecureSecret,
  isLikelySecretKey,
  detectSecretCategory,
  PRESET_SECRET_GROUPS,
  type VaultSecret,
} from "./secrets-vault";

test("isLikelySecretKey identifies sensitive key names", () => {
  assert.equal(isLikelySecretKey("DATABASE_PASSWORD"), true);
  assert.equal(isLikelySecretKey("STRIPE_SECRET_KEY"), true);
  assert.equal(isLikelySecretKey("JWT_AUTH_TOKEN"), true);
  assert.equal(isLikelySecretKey("PRIVATE_KEY"), true);
  assert.equal(isLikelySecretKey("PORT"), false);
  assert.equal(isLikelySecretKey("HOST"), false);
  assert.equal(isLikelySecretKey("NODE_ENV"), false);
});

test("detectSecretCategory categorizes keys accurately", () => {
  assert.equal(detectSecretCategory("POSTGRES_URL"), "database");
  assert.equal(detectSecretCategory("STRIPE_KEY"), "payment");
  assert.equal(detectSecretCategory("SMTP_HOST"), "email");
  assert.equal(detectSecretCategory("JWT_SECRET"), "auth");
  assert.equal(detectSecretCategory("OPENAI_API_KEY"), "api_key");
  assert.equal(detectSecretCategory("CUSTOM_VAR"), "general");
});

test("parseDotEnv parses raw .env content correctly", () => {
  const sample = `
# System configuration
export PORT=3000
NODE_ENV="production"
DATABASE_URL='postgres://user:pass@localhost:5432/app'
# Secret token below
API_SECRET_KEY=superSecretValue123
EMPTY_VAL=
`;

  const secrets = parseDotEnv(sample);
  assert.equal(secrets.length, 5);

  const port = secrets.find((s) => s.key === "PORT");
  assert.ok(port);
  assert.equal(port.value, "3000");
  assert.equal(port.isSecret, false);

  const nodeEnv = secrets.find((s) => s.key === "NODE_ENV");
  assert.ok(nodeEnv);
  assert.equal(nodeEnv.value, "production");

  const dbUrl = secrets.find((s) => s.key === "DATABASE_URL");
  assert.ok(dbUrl);
  assert.equal(dbUrl.value, "postgres://user:pass@localhost:5432/app");
  assert.equal(dbUrl.category, "database");

  const secretKey = secrets.find((s) => s.key === "API_SECRET_KEY");
  assert.ok(secretKey);
  assert.equal(secretKey.value, "superSecretValue123");
  assert.equal(secretKey.isSecret, true);
});

test("exportToDotEnv produces valid dotenv output with and without masking", () => {
  const secrets: VaultSecret[] = [
    {
      id: "1",
      key: "PUBLIC_VAR",
      value: "hello world",
      isSecret: false,
      updatedAt: Date.now(),
    },
    {
      id: "2",
      key: "APP_SECRET",
      value: "verySecret99",
      isSecret: true,
      updatedAt: Date.now(),
    },
  ];

  const unmasked = exportToDotEnv(secrets, false);
  assert.match(unmasked, /PUBLIC_VAR="hello world"/);
  assert.match(unmasked, /APP_SECRET=verySecret99/);

  const masked = exportToDotEnv(secrets, true);
  assert.match(masked, /PUBLIC_VAR="hello world"/);
  assert.match(masked, /APP_SECRET=••••••••••••/);
});

test("interpolateVariables resolves nested variable references", () => {
  const context = {
    USER: "alice",
    HOST: "internal.lan",
    PORT: "5432",
  };

  const template = "postgres://${USER}@${HOST}:$PORT/mydb";
  const { resolved, missingVars } = interpolateVariables(template, context);

  assert.equal(resolved, "postgres://alice@internal.lan:5432/mydb");
  assert.equal(missingVars.length, 0);

  // Missing variable test
  const missingTemplate = "${USER}:${PASSWORD}@${HOST}";
  const res2 = interpolateVariables(missingTemplate, context);
  assert.equal(res2.resolved, "alice:${PASSWORD}@internal.lan");
  assert.deepEqual(res2.missingVars, ["PASSWORD"]);
});

test("generateSecureSecret creates secrets of expected length and format", () => {
  const hex = generateSecureSecret("hex64");
  assert.equal(hex.length, 64);
  assert.match(hex, /^[0-9a-f]{64}$/);

  const alnum = generateSecureSecret("alphanumeric32");
  assert.equal(alnum.length, 32);
  assert.match(alnum, /^[0-9a-zA-Z]{32}$/);

  const uuid = generateSecureSecret("uuid");
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  const b64 = generateSecureSecret("base64");
  assert.ok(b64.length >= 24);
});

test("PRESET_SECRET_GROUPS are all valid", () => {
  assert.ok(PRESET_SECRET_GROUPS.length >= 4);
  for (const grp of PRESET_SECRET_GROUPS) {
    assert.ok(grp.name.length > 0);
    assert.ok(grp.secrets.length > 0);
    for (const s of grp.secrets) {
      assert.ok(s.key.length > 0);
    }
  }
});
