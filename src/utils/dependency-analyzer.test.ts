import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDomainToUrlEnvRows,
  buildConnectionEnvForDb,
  buildFallbackDependencyAnalysis,
  buildMagicDomainHost,
  deriveProjectNameFromImage,
  generateRandomSecret,
  isSecretKey,
  parseConnectionUriParts,
  parseEnvPaste,
  sanitizeDatabaseName,
  sanitizeProjectSlug,
  toEditableEnvRows,
} from "./dependency-analyzer";

test("deriveProjectNameFromImage and sanitizeProjectSlug produce clean slugs", () => {
  assert.equal(
    deriveProjectNameFromImage("ghcr.io/immich-app/immich-server:release"),
    "immich-server",
  );
  assert.equal(deriveProjectNameFromImage("docker.n8n.io/n8nio/n8n"), "n8n");
  assert.equal(sanitizeProjectSlug("  My App! (v2) "), "my-app-v2");
});

test("isSecretKey and generateRandomSecret handle secret variables safely", () => {
  assert.equal(isSecretKey("JWT_SECRET"), true);
  assert.equal(isSecretKey("POSTGRES_PASSWORD"), true);
  assert.equal(isSecretKey("OPENAI_API_KEY"), true);
  assert.equal(isSecretKey("GENERIC_TIMEZONE"), false);
  const s1 = generateRandomSecret(16);
  const s2 = generateRandomSecret(16);
  assert.equal(s1.length, 32);
  assert.notEqual(s1, s2);
});

test("parseEnvPaste parses .env blocks with quotes and comments", () => {
  const rows = parseEnvPaste(`
    # App config
    APP_URL="https://app.example.com"
    export AUTH_SECRET='super-secret-value'
    EMPTY_KEY=
  `);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { key: "APP_URL", value: "https://app.example.com", secret: false });
  assert.deepEqual(rows[1], {
    key: "AUTH_SECRET",
    value: "super-secret-value",
    secret: true,
  });
  assert.deepEqual(rows[2], { key: "EMPTY_KEY", value: "", secret: false });
});

test("buildConnectionEnvForDb injects URL and split host/user/pass keys for postgres", () => {
  const uri = "postgresql://hx:pw123@host.docker.internal:15432/appdb";
  const parts = parseConnectionUriParts(uri);
  assert.equal(parts?.host, "host.docker.internal");
  assert.equal(parts?.port, "15432");
  assert.equal(parts?.user, "hx");
  assert.equal(parts?.password, "pw123");
  assert.equal(parts?.database, "appdb");

  const injected = buildConnectionEnvForDb({
    engine: "postgres",
    internalConnectionString: uri,
    existingKeys: [
      "DATABASE_URL",
      "POSTGRES_HOST",
      "POSTGRES_PORT",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "POSTGRES_DB",
    ],
  });
  assert.equal(injected.DATABASE_URL, uri);
  assert.equal(injected.POSTGRES_HOST, "host.docker.internal");
  assert.equal(injected.POSTGRES_PORT, "15432");
  assert.equal(injected.POSTGRES_USER, "hx");
  assert.equal(injected.POSTGRES_PASSWORD, "pw123");
  assert.equal(injected.POSTGRES_DB, "appdb");
});

test("buildConnectionEnvForDb supports n8n DB_POSTGRESDB_* and Redis keys", () => {
  const pg = buildConnectionEnvForDb({
    engine: "postgres",
    internalConnectionString: "postgresql://hx:pw@host.docker.internal:15432/n8n",
    existingKeys: ["DB_POSTGRESDB_HOST", "DB_POSTGRESDB_DATABASE"],
  });
  assert.equal(pg.DB_TYPE, "postgresdb");
  assert.equal(pg.DB_POSTGRESDB_HOST, "host.docker.internal");
  assert.equal(pg.DB_POSTGRESDB_PORT, "15432");
  assert.equal(pg.DB_POSTGRESDB_DATABASE, "n8n");

  const redis = buildConnectionEnvForDb({
    engine: "redis",
    internalConnectionString: "redis://:redispw@host.docker.internal:16379",
    existingKeys: ["REDIS_URL", "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD"],
  });
  assert.equal(redis.REDIS_URL, "redis://:redispw@host.docker.internal:16379");
  assert.equal(redis.REDIS_HOST, "host.docker.internal");
  assert.equal(redis.REDIS_PORT, "16379");
  assert.equal(redis.REDIS_PASSWORD, "redispw");
});

test("buildFallbackDependencyAnalysis converts presets into editable rows", () => {
  const analysis = buildFallbackDependencyAnalysis({
    image: "flowiseai/flowise:latest",
    appName: "Flowise",
    presetEnv: { FLOWISE_SECRETKEY_OVERWRITE: "", PORT: "3000" },
    presetPort: 3000,
    imageVerified: false,
  });
  assert.equal(analysis.detectedPort, 3000);
  assert.equal(analysis.warnings.length, 1);
  const rows = toEditableEnvRows(analysis);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].secret, true);
  assert.equal(rows[0].required, true);
});

test("sanitizeDatabaseName enforces ^[a-z][a-z0-9_]{0,40}$ across slugs and engines", () => {
  const validRe = /^[a-z][a-z0-9_]{0,40}$/;
  const cases = [
    sanitizeDatabaseName("gitea", "postgres"),
    sanitizeDatabaseName("n8n-uxr0", "postgres"),
    sanitizeDatabaseName("123-app", "redis"),
    sanitizeDatabaseName("very-long-application-project-slug-that-exceeds-limits", "mariadb"),
    sanitizeDatabaseName("My_App.Prod", "mongodb", "k9x2"),
  ];
  assert.equal(cases[0], "gitea_postgres");
  assert.equal(cases[1], "n8n_uxr0_postgres");
  assert.ok(cases[2].startsWith("db_123_app_redis"));
  for (const name of cases) {
    assert.match(name, validRe);
    assert.ok(name.length <= 41);
  }
});

test("buildConnectionEnvForDb injects app-specific keys for Gitea, Ghost, Metabase, and Paperless", () => {
  const pgUri = "postgresql://hx:pw@host.docker.internal:15432/gitea_postgres";
  const giteaEnv = buildConnectionEnvForDb({
    engine: "postgres",
    internalConnectionString: pgUri,
    existingKeys: ["GITEA__server__ROOT_URL"],
    imageHint: "gitea/gitea:latest",
  });
  assert.equal(giteaEnv.GITEA__database__DB_TYPE, "postgres");
  assert.equal(giteaEnv.GITEA__database__HOST, "host.docker.internal:15432");
  assert.equal(giteaEnv.GITEA__database__NAME, "gitea_postgres");
  assert.equal(giteaEnv.GITEA__database__USER, "hx");
  assert.equal(giteaEnv.GITEA__database__PASSWD, "pw");

  const ghostEnv = buildConnectionEnvForDb({
    engine: "mysql",
    internalConnectionString: "mysql://hx:pw@host.docker.internal:13306/ghost_mysql",
    existingKeys: ["url"],
    imageHint: "ghost:5",
  });
  assert.equal(ghostEnv.database__client, "mysql");
  assert.equal(ghostEnv.database__connection__host, "host.docker.internal");
  assert.equal(ghostEnv.database__connection__database, "ghost_mysql");

  const paperlessRedis = buildConnectionEnvForDb({
    engine: "redis",
    internalConnectionString: "redis://:rpw@host.docker.internal:16379",
    existingKeys: ["PAPERLESS_SECRET_KEY"],
    imageHint: "ghcr.io/paperless-ngx/paperless-ngx:latest",
  });
  assert.equal(paperlessRedis.PAPERLESS_REDIS, "redis://:rpw@host.docker.internal:16379");
});

test("buildMagicDomainHost and applyDomainToUrlEnvRows wire domain without clobbering manual edits", () => {
  const host1 = buildMagicDomainHost("gitea", "app-name.127-0-0-1.sslip.io");
  assert.equal(host1, "gitea.127-0-0-1.sslip.io");

  const initialRows = [
    {
      id: "1",
      key: "GITEA__server__DOMAIN",
      value: "",
      required: false,
      secret: false,
      source: "blueprint",
    },
    {
      id: "2",
      key: "GITEA__server__ROOT_URL",
      value: "",
      required: false,
      secret: false,
      source: "blueprint",
    },
    {
      id: "3",
      key: "PUBLIC_URL",
      value: "https://manual.custom.dev",
      required: false,
      secret: false,
      source: "custom",
    },
  ];

  const afterMagic = applyDomainToUrlEnvRows(initialRows, host1);
  assert.equal(afterMagic[0].value, "gitea.127-0-0-1.sslip.io");
  assert.equal(afterMagic[1].value, "https://gitea.127-0-0-1.sslip.io");
  assert.equal(afterMagic[2].value, "https://manual.custom.dev");

  const afterCustom = applyDomainToUrlEnvRows(afterMagic, "git.acme.io", host1);
  assert.equal(afterCustom[0].value, "git.acme.io");
  assert.equal(afterCustom[1].value, "https://git.acme.io");
  assert.equal(afterCustom[2].value, "https://manual.custom.dev");
});
