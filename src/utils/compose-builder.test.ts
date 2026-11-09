import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDockerComposeYaml,
  parseDockerComposeYaml,
  validateComposeStack,
  detectDependencyGraph,
  detectServiceCategory,
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

test("all PRESET_STACKS validate without errors", () => {
  assert.ok(PRESET_STACKS.length >= 4);
  for (const preset of PRESET_STACKS) {
    const val = validateComposeStack(preset.stack);
    assert.equal(val.valid, true, `Preset "${preset.name}" had errors: ${val.errors.join(", ")}`);
    const yaml = generateDockerComposeYaml(preset.stack);
    assert.ok(yaml.length > 50);
  }
});
