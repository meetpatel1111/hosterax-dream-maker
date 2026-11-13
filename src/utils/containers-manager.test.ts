// src/utils/containers-manager.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  formatContainerName,
  formatShortId,
  formatPortMappings,
  isSystemContainer,
  calculateContainerFleetMetrics,
  filterContainers,
  parseContainerEnv,
  getContainerBadgeColor,
  detectProjectAssociation,
  type ContainerItem,
} from "./containers-manager";

describe("containers-manager", () => {
  const mockContainers: ContainerItem[] = [
    {
      Id: "04098658a638acd3d0a4e9047d228b866f8aa8aab73c833bd55726c6a49b696d",
      Names: ["/hx_demo_app"],
      Image: "nginx:alpine",
      State: "running",
      Status: "Up 3 hours",
      Ports: [{ IP: "0.0.0.0", PrivatePort: 80, PublicPort: 3001, Type: "tcp" }],
    },
    {
      Id: "e22651667148e8604dc83abb43ed339dd53240da3096f71857d5d30229e47866",
      Names: ["/hx_edge"],
      Image: "caddy:2-alpine",
      State: "running",
      Status: "Up 3 hours",
      Ports: [],
    },
    {
      Id: "55a386bc7c7d0cb4f115183adc6ba863fcb58067769be31d8c2808aa9409ec13",
      Names: ["/alpine_real_oci"],
      Image: "alpine:latest",
      State: "running",
      Status: "Up 25 minutes",
      Ports: [{ IP: "0.0.0.0", PrivatePort: 3009, PublicPort: 3009, Type: "tcp" }],
    },
    {
      Id: "99a386bc7c7d0cb4f115183adc6ba863fcb58067769be31d8c2808aa9409ec99",
      Names: ["/redis_cache"],
      Image: "redis:alpine",
      State: "exited",
      Status: "Exited (0) 10 minutes ago",
      Ports: [{ IP: "0.0.0.0", PrivatePort: 6379, PublicPort: 6379, Type: "tcp" }],
    },
  ];

  it("formatContainerName removes leading slash", () => {
    assert.strictEqual(formatContainerName(["/my_app"]), "my_app");
    assert.strictEqual(formatContainerName(["plain_app"]), "plain_app");
    assert.strictEqual(formatContainerName([]), "unnamed-container");
  });

  it("formatShortId truncates to 12 hex chars", () => {
    assert.strictEqual(
      formatShortId("04098658a638acd3d0a4e9047d228b866f8aa8aab73c833bd55726c6a49b696d"),
      "04098658a638",
    );
    assert.strictEqual(formatShortId(""), "");
  });

  it("formatPortMappings extracts active published ports", () => {
    const mappings = formatPortMappings([
      { IP: "0.0.0.0", PrivatePort: 80, PublicPort: 3001, Type: "tcp" },
      { IP: "0.0.0.0", PrivatePort: 443 }, // unexposed internal
    ]);
    assert.strictEqual(mappings.length, 1);
    assert.strictEqual(mappings[0].hostPort, 3001);
    assert.strictEqual(mappings[0].containerPort, 80);
    assert.strictEqual(mappings[0].url, "http://localhost:3001");
  });

  it("isSystemContainer detects HosteraX core containers", () => {
    assert.strictEqual(isSystemContainer("/hx_demo_app"), true);
    assert.strictEqual(isSystemContainer("hx_edge"), true);
    assert.strictEqual(isSystemContainer("hosterax_edge"), true);
    assert.strictEqual(isSystemContainer("/caddy_router"), true);
    assert.strictEqual(isSystemContainer("/my_wordpress"), false);
    assert.strictEqual(isSystemContainer("/alpine_real_oci"), false);
  });

  it("calculateContainerFleetMetrics computes correct aggregates", () => {
    const metrics = calculateContainerFleetMetrics(mockContainers);
    assert.strictEqual(metrics.total, 4);
    assert.strictEqual(metrics.running, 3);
    assert.strictEqual(metrics.stopped, 1);
    assert.strictEqual(metrics.exposedPortsCount, 3);
    assert.strictEqual(metrics.systemCount, 2); // hx_demo_app, hx_edge
    assert.strictEqual(metrics.userCount, 2); // alpine_real_oci, redis_cache
  });

  it("filterContainers filters by search query across name, image, and port", () => {
    const byName = filterContainers(mockContainers, "alpine_real", "all");
    assert.strictEqual(byName.length, 1);
    assert.strictEqual(byName[0].Names[0], "/alpine_real_oci");

    const byImage = filterContainers(mockContainers, "redis", "all");
    assert.strictEqual(byImage.length, 1);
    assert.strictEqual(byImage[0].Names[0], "/redis_cache");

    const byPort = filterContainers(mockContainers, "3009", "all");
    assert.strictEqual(byPort.length, 1);
    assert.strictEqual(byPort[0].Names[0], "/alpine_real_oci");
  });

  it("filterContainers filters by status category", () => {
    const running = filterContainers(mockContainers, "", "running");
    assert.strictEqual(running.length, 3);

    const stopped = filterContainers(mockContainers, "", "stopped");
    assert.strictEqual(stopped.length, 1);
    assert.strictEqual(stopped[0].Names[0], "/redis_cache");

    const system = filterContainers(mockContainers, "", "system");
    assert.strictEqual(system.length, 2);
  });

  it("parseContainerEnv turns KEY=VALUE list into map", () => {
    const env = parseContainerEnv(["PORT=80", "HOST=0.0.0.0", "NODE_ENV=production"]);
    assert.deepStrictEqual(env, {
      PORT: "80",
      HOST: "0.0.0.0",
      NODE_ENV: "production",
    });
  });

  it("getContainerBadgeColor provides correct badge style", () => {
    const running = getContainerBadgeColor("running");
    assert.strictEqual(running.label, "Running");
    assert.ok(running.badgeClass.includes("emerald"));

    const exited = getContainerBadgeColor("exited");
    assert.strictEqual(exited.label, "Exited");
    assert.ok(exited.badgeClass.includes("zinc"));
  });

  it("detectProjectAssociation correctly resolves project relations", () => {
    // 1. By prefix convention
    assert.strictEqual(detectProjectAssociation(mockContainers[0], ["demo-app"]), "demo-app");
    // 2. Core system container has no project association
    assert.strictEqual(detectProjectAssociation(mockContainers[1], ["demo-app"]), null);
    // 3. Ad-hoc container has no project association
    assert.strictEqual(detectProjectAssociation(mockContainers[2], ["demo-app"]), null);
    // 4. By explicit label
    const labeledContainer = {
      ...mockContainers[3],
      Labels: { "hosterax.project": "ecommerce-api" },
    };
    assert.strictEqual(detectProjectAssociation(labeledContainer, []), "ecommerce-api");
  });
});
