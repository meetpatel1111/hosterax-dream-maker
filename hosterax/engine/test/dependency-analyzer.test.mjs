import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDependenciesFromSources,
  extractReadmeHints,
  fetchRemoteOciConfig,
  matchCuratedAppBlueprint,
  parseComposeDependencies,
  parseDockerHubRepo,
  parseEnvFileText,
  parseGithubOwnerRepo,
  parseRegistryImageRef,
} from "../src/dependency-analyzer.mjs";

test("parseGithubOwnerRepo and parseDockerHubRepo handle common registry and repo URLs", () => {
  assert.deepEqual(parseGithubOwnerRepo("https://github.com/langfuse/langfuse.git"), {
    owner: "langfuse",
    repo: "langfuse",
  });
  assert.equal(parseGithubOwnerRepo("https://selfhosted.example.com"), null);

  assert.equal(parseDockerHubRepo("nginx:alpine"), "library/nginx");
  assert.equal(parseDockerHubRepo("n8nio/n8n:latest"), "n8nio/n8n");
  assert.equal(parseDockerHubRepo("ghcr.io/open-webui/open-webui:main"), null);
  assert.equal(parseDockerHubRepo("docker.n8n.io/n8nio/n8n"), null);
});

test("parseEnvFileText extracts comments, defaults, required flags, and filters system noise", () => {
  const parsed = parseEnvFileText(`
# Database connection string (required)
DATABASE_URL=
# Secret salt for sessions
NEXTAUTH_SECRET=changeme
GENERIC_TIMEZONE="UTC"
PATH=/usr/local/bin
  `);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].key, "DATABASE_URL");
  assert.equal(parsed[0].required, true);
  assert.match(parsed[0].description, /Database connection string/);

  assert.equal(parsed[1].key, "NEXTAUTH_SECRET");
  assert.equal(parsed[1].required, true);
  assert.equal(parsed[1].secret, true);
  assert.equal(parsed[1].defaultValue, "");

  assert.equal(parsed[2].key, "GENERIC_TIMEZONE");
  assert.equal(parsed[2].required, false);
  assert.equal(parsed[2].defaultValue, "UTC");
});

test("parseComposeDependencies detects postgres/redis companion services and app env", () => {
  const yaml = `
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
  redis:
    image: redis:7-alpine
  web:
    image: langfuse/langfuse:2
    ports:
      - "3000:3000"
    volumes:
      - langfuse_data:/app/data
    environment:
      - DATABASE_URL=\${DATABASE_URL:?err}
      - NEXTAUTH_SECRET=\${NEXTAUTH_SECRET:-changeme}
      - TELEMETRY_ENABLED=true
    depends_on:
      - postgres
      - redis
`;
  const parsed = parseComposeDependencies(yaml, "langfuse/langfuse:2");
  assert.equal(parsed.databases.length, 2);
  assert.deepEqual(
    parsed.databases.map((d) => d.engine),
    ["postgres", "redis"],
  );
  assert.deepEqual(parsed.ports, [3000]);
  assert.deepEqual(parsed.volumes, ["/app/data"]);
  assert.equal(parsed.envVars.length, 3);
  assert.equal(parsed.envVars[0].key, "DATABASE_URL");
  assert.equal(parsed.envVars[0].required, true);
  assert.equal(parsed.envVars[1].key, "NEXTAUTH_SECRET");
  assert.equal(parsed.envVars[1].secret, true);
  assert.equal(parsed.envVars[1].required, true);
  assert.equal(parsed.envVars[2].defaultValue, "true");
});

test("extractReadmeHints pulls docker run -e flags, ports, and DB mentions", () => {
  const readme = `
Run with PostgreSQL and Redis:
\`\`\`bash
docker run -d -p 8080:5678 -e N8N_HOST=0.0.0.0 -e DB_POSTGRESDB_PASSWORD=changeme n8nio/n8n
\`\`\`
`;
  const hints = extractReadmeHints(readme);
  assert.deepEqual(hints.ports, [5678]);
  assert.deepEqual(hints.mentionedDbs, ["postgres", "redis"]);
  assert.equal(hints.dockerRunEnvs.length, 2);
  assert.equal(hints.dockerRunEnvs[1].key, "DB_POSTGRESDB_PASSWORD");
  assert.equal(hints.dockerRunEnvs[1].required, true);
});

test("analyzeDependenciesFromSources merges OCI, compose, envExample, and presets without self-DB loop", () => {
  const result = analyzeDependenciesFromSources({
    image: "myorg/myapp:latest",
    appName: "MyApp",
    presetEnv: { APP_MODE: "production" },
    presetPort: 8080,
    imageVerified: false,
    ociConfig: {
      exposedPorts: [8080],
      volumes: ["/data"],
      env: ["PATH=/usr/bin", "PORT=8080", "API_SECRET="],
    },
    envExample: "DATABASE_URL=\nREDIS_HOST=localhost\n",
    sourcesChecked: ["curated-catalog", "oci-image", "github-env-example"],
  });

  assert.equal(result.detectedPort, 8080);
  assert.deepEqual(result.volumes, ["/data"]);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(
    result.databases.map((d) => d.engine),
    ["postgres", "redis"],
  );
  assert.ok(result.envVars.some((e) => e.key === "API_SECRET" && e.required && e.secret));
  assert.ok(result.envVars.some((e) => e.key === "APP_MODE" && e.defaultValue === "production"));
  assert.ok(!result.envVars.some((e) => e.key === "PATH"));

  const pgSelf = analyzeDependenciesFromSources({
    image: "postgres:16-alpine",
    appName: "Postgres",
    ociConfig: {
      exposedPorts: [5432],
      volumes: ["/var/lib/postgresql/data"],
      env: ["POSTGRES_PASSWORD="],
    },
  });
  assert.equal(pgSelf.databases.length, 0);
});

test("parseRegistryImageRef normalizes Docker Hub, library, and GHCR image refs", () => {
  assert.deepEqual(parseRegistryImageRef("postgres:16-alpine"), {
    registry: "registry-1.docker.io",
    repo: "library/postgres",
    tag: "16-alpine",
  });
  assert.deepEqual(parseRegistryImageRef("gitea/gitea:latest"), {
    registry: "registry-1.docker.io",
    repo: "gitea/gitea",
    tag: "latest",
  });
  assert.deepEqual(parseRegistryImageRef("ghcr.io/paperless-ngx/paperless-ngx:2.11"), {
    registry: "ghcr.io",
    repo: "paperless-ngx/paperless-ngx",
    tag: "2.11",
  });
});

test("fetchRemoteOciConfig resolves multi-arch OCI index and config blob", async () => {
  const mockFetch = async (url) => {
    if (url.startsWith("https://auth.docker.io/token")) {
      return { ok: true, json: async () => ({ token: "tok_123" }) };
    }
    if (url.endsWith("/manifests/latest")) {
      return {
        ok: true,
        json: async () => ({
          manifests: [
            { platform: { os: "linux", architecture: "amd64" }, digest: "sha256:amd64" },
          ],
        }),
      };
    }
    if (url.endsWith("/manifests/sha256:amd64")) {
      return { ok: true, json: async () => ({ config: { digest: "sha256:cfg" } }) };
    }
    if (url.endsWith("/blobs/sha256:cfg")) {
      return {
        ok: true,
        json: async () => ({
          config: {
            ExposedPorts: { "3000/tcp": {}, "22/tcp": {} },
            Volumes: { "/data": {} },
            Env: ["GITEA_CUSTOM=/data/gitea"],
            Labels: { "org.opencontainers.image.source": "https://github.com/go-gitea/gitea" },
          },
        }),
      };
    }
    return { ok: false };
  };

  const cfg = await fetchRemoteOciConfig("gitea/gitea:latest", mockFetch, 2000);
  assert.deepEqual(cfg.exposedPorts, [3000, 22]);
  assert.deepEqual(cfg.volumes, ["/data"]);
  assert.deepEqual(cfg.env, ["GITEA_CUSTOM=/data/gitea"]);
  assert.equal(cfg.labels["org.opencontainers.image.source"], "https://github.com/go-gitea/gitea");
});

test("matchCuratedAppBlueprint supplies Gitea env vars, /data volume, and PostgreSQL recommendation", () => {
  assert.ok(matchCuratedAppBlueprint("gitea/gitea:latest", "Gitea"));
  const result = analyzeDependenciesFromSources({
    image: "gitea/gitea:latest",
    appName: "Gitea",
  });
  assert.equal(result.detectedPort, 3000);
  assert.ok(result.volumes.includes("/data"));
  assert.ok(result.sourcesChecked.includes("curated-blueprint"));
  assert.ok(result.databases.some((d) => d.engine === "postgres" && d.recommended === true));
  assert.ok(result.envVars.some((e) => e.key === "GITEA__security__SECRET_KEY" && e.secret && e.required));
  assert.ok(result.envVars.some((e) => e.key === "GITEA__server__ROOT_URL"));
});

