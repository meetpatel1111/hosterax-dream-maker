import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDockerComposeYaml,
  parseDockerComposeYaml,
  validateComposeStack,
  detectDependencyGraph,
  detectServiceCategory,
  extractMagicVariables,
  resolveStackMagicVariables,
  parseCpuLimit,
  parseMemoryLimitMb,
  buildStackDeploymentPlan,
  PRESET_STACKS,
  ComposeStack,
} from "./compose-builder";

test("detectServiceCategory correctly maps names and images to categories", () => {
  assert.equal(detectServiceCategory("pg", "postgres:16"), "database");
  assert.equal(detectServiceCategory("redis-cache", "redis:alpine"), "cache");
  assert.equal(detectServiceCategory("next-client", "node:20"), "frontend");
  assert.equal(detectServiceCategory("fastapi-server", "python:3.11"), "backend");
  assert.equal(detectServiceCategory("celery_worker", "python:3.11"), "worker");
  assert.equal(detectServiceCategory("custom-thing", "alpine:latest"), "other");
});

test("generateDockerComposeYaml produces valid compose YAML", () => {
  const stack: ComposeStack = {
    name: "test-stack",
    services: [
      {
        id: "1",
        name: "web",
        image: "nginx:alpine",
        category: "frontend",
        ports: [{ host: 8080, container: 80 }],
        env: [{ key: "ENV", value: "prod" }],
        volumes: [{ hostPath: "nginx_cfg", containerPath: "/etc/nginx", mode: "ro" }],
        dependsOn: ["api"],
        restartPolicy: "unless-stopped",
      },
      {
        id: "2",
        name: "api",
        image: "node:22",
        category: "backend",
        ports: [{ host: 3000, container: 3000 }],
        env: [],
        volumes: [],
        dependsOn: [],
        restartPolicy: "always",
      },
    ],
  };

  const yaml = generateDockerComposeYaml(stack);
  assert.match(yaml, /services:/);
  assert.match(yaml, /web:/);
  assert.match(yaml, /image: nginx:alpine/);
  assert.match(yaml, /8080:80/);
  assert.match(yaml, /nginx_cfg:\/etc\/nginx:ro/);
  assert.match(yaml, /depends_on:\n\s+- api/);
  assert.match(yaml, /volumes:\n\s+nginx_cfg: null/);
});

test("parseDockerComposeYaml parses raw compose YAML back into stack model", () => {
  const rawYaml = `
services:
  app:
    image: python:3.11
    ports:
      - "8000:8000"
    environment:
      DEBUG: "false"
      SECRET: "xyz"
    depends_on:
      - db
    restart: always
  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_PASSWORD=secret
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
`;

  const stack = parseDockerComposeYaml(rawYaml, "parsed-stack");
  assert.equal(stack.name, "parsed-stack");
  assert.equal(stack.services.length, 2);

  const appSvc = stack.services.find((s) => s.name === "app");
  assert.ok(appSvc);
  assert.equal(appSvc.image, "python:3.11");
  assert.equal(appSvc.ports.length, 1);
  assert.equal(appSvc.ports[0].host, 8000);
  assert.equal(appSvc.ports[0].container, 8000);
  assert.deepEqual(appSvc.dependsOn, ["db"]);
  assert.equal(appSvc.restartPolicy, "always");

  const dbSvc = stack.services.find((s) => s.name === "db");
  assert.ok(dbSvc);
  assert.equal(dbSvc.category, "database");
  assert.equal(dbSvc.volumes.length, 1);
  assert.equal(dbSvc.volumes[0].hostPath, "pgdata");
  assert.equal(dbSvc.volumes[0].containerPath, "/var/lib/postgresql/data");
});

test("validateComposeStack catches duplicate service names and port collisions", () => {
  const invalidStack: ComposeStack = {
    name: "bad-stack",
    services: [
      {
        id: "1",
        name: "api",
        image: "node:22",
        category: "backend",
        ports: [{ host: 3000, container: 3000 }],
        env: [],
        volumes: [],
        dependsOn: [],
        restartPolicy: "no",
      },
      {
        id: "2",
        name: "api", // Duplicate name
        image: "python:3.11",
        category: "backend",
        ports: [{ host: 3000, container: 8000 }], // Port collision 3000
        env: [],
        volumes: [],
        dependsOn: [],
        restartPolicy: "no",
      },
    ],
  };

  const validation = validateComposeStack(invalidStack);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((e) => e.includes("Duplicate service name")));
  assert.ok(validation.errors.some((e) => e.includes("Port conflict")));
});

test("detectDependencyGraph correctly detects valid DAG vs circular dependencies", () => {
  const dagStack: ComposeStack = {
    name: "dag",
    services: [
      {
        id: "1",
        name: "web",
        image: "node:22",
        category: "frontend",
        ports: [],
        env: [],
        volumes: [],
        dependsOn: ["api"],
        restartPolicy: "no",
      },
      {
        id: "2",
        name: "api",
        image: "node:22",
        category: "backend",
        ports: [],
        env: [],
        volumes: [],
        dependsOn: ["db"],
        restartPolicy: "no",
      },
      {
        id: "3",
        name: "db",
        image: "postgres:16",
        category: "database",
        ports: [],
        env: [],
        volumes: [],
        dependsOn: [],
        restartPolicy: "no",
      },
    ],
  };

  const res = detectDependencyGraph(dagStack);
  assert.equal(res.hasCycle, false);
  // db must come before api, api must come before web
  const dbIdx = res.topologicalOrder.indexOf("db");
  const apiIdx = res.topologicalOrder.indexOf("api");
  const webIdx = res.topologicalOrder.indexOf("web");
  assert.ok(dbIdx < apiIdx);
  assert.ok(apiIdx < webIdx);

  // Now create circular cycle: db depends on web
  dagStack.services[2].dependsOn = ["web"];
  const cycleRes = detectDependencyGraph(dagStack);
  assert.equal(cycleRes.hasCycle, true);

  const valRes = validateComposeStack(dagStack);
  assert.equal(valRes.valid, false);
  assert.ok(valRes.errors.some((e) => e.includes("Circular dependency")));
});

test("extractMagicVariables and resolveStackMagicVariables share secrets consistently across services", () => {
  const stack = JSON.parse(JSON.stringify(PRESET_STACKS[0].stack)) as ComposeStack;
  stack.services[1].publicDomain = "api.acme.dev";

  const descriptors = extractMagicVariables(stack);
  const names = descriptors.map((d) => d.name);
  assert.ok(names.includes("SERVICE_PASSWORD_POSTGRES"));
  assert.ok(names.includes("SERVICE_URL_API"));
  assert.ok(names.includes("SERVICE_BASE64_64_JWT"));

  let counter = 1;
  const { resolvedStack, resolvedVars } = resolveStackMagicVariables(stack, {
    randomHex: (bytes) => String(counter++).padStart(2, "0").repeat(bytes),
  });

  const apiSvc = resolvedStack.services.find((s) => s.name === "api")!;
  const dbSvc = resolvedStack.services.find((s) => s.name === "db")!;
  const webSvc = resolvedStack.services.find((s) => s.name === "web")!;

  const dbPass = dbSvc.env.find((e) => e.key === "POSTGRES_PASSWORD")?.value;
  const apiDbUrl = apiSvc.env.find((e) => e.key === "DATABASE_URL")?.value;
  const webApiUrl = webSvc.env.find((e) => e.key === "VITE_API_URL")?.value;

  assert.equal(dbPass, resolvedVars.SERVICE_PASSWORD_POSTGRES);
  assert.ok(apiDbUrl?.includes(`postgres:${dbPass}@db:5432/app`));
  assert.equal(webApiUrl, "https://api.acme.dev");
});

test("buildStackDeploymentPlan orders dependencies first, parses resource quotas, and skips .localhost domains", () => {
  const stack = JSON.parse(JSON.stringify(PRESET_STACKS[0].stack)) as ComposeStack;
  stack.services[0].publicDomain = "app.acme.dev";
  stack.services[1].publicDomain = "api.localhost";
  stack.services[1].cpuLimit = "1.5";
  stack.services[1].memoryLimit = "1G";

  const { plan } = buildStackDeploymentPlan(stack, {
    overrides: { SERVICE_PASSWORD_POSTGRES: "pgsecret99" },
  });

  const dbIdx = plan.findIndex((p) => p.serviceName === "db");
  const apiIdx = plan.findIndex((p) => p.serviceName === "api");
  const webIdx = plan.findIndex((p) => p.serviceName === "web");
  assert.ok(dbIdx < apiIdx);
  assert.ok(apiIdx < webIdx);

  const apiPlan = plan[apiIdx];
  assert.equal(apiPlan.cpuLimit, 1.5);
  assert.equal(apiPlan.memoryMbLimit, 1024);
  assert.equal(apiPlan.customDomainToBind, undefined);
  assert.equal(apiPlan.env.DATABASE_URL, "postgres://postgres:pgsecret99@db:5432/app");

  const webPlan = plan[webIdx];
  assert.equal(webPlan.customDomainToBind, "app.acme.dev");

  assert.equal(parseCpuLimit("0.5"), 0.5);
  assert.equal(parseCpuLimit(""), null);
  assert.equal(parseMemoryLimitMb("512m"), 512);
  assert.equal(parseMemoryLimitMb("2Gi"), 2048);
});

test("all PRESET_STACKS validate without errors", () => {
  assert.ok(PRESET_STACKS.length >= 4);
  for (const preset of PRESET_STACKS) {
    const val = validateComposeStack(preset.stack);
    assert.equal(val.valid, true, `Preset "${preset.name}" had errors: ${val.errors.join(", ")}`);
    const yaml = generateDockerComposeYaml(preset.stack);
    assert.ok(yaml.length > 50);
  }
});
