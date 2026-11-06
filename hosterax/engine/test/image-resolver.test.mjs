import { test } from "node:test";
import { isSafeImageRef } from "../src/security.mjs";
import assert from "node:assert/strict";
import {
  pullWithUniversalHealing,
  isTransientPullFailure,
  normalizeImageSource,
  generateCandidateImageTags,
} from "../src/image-resolver.mjs";

process.env.HOSTERAX_PULL_RETRY_MS = "1,1";

// A scripted Docker: `script(ref)` returns the exit code and what `docker pull` printed.
function run(script, initialTag = "nginx:alpine") {
  const pulled = [];
  const published = [];
  const runArgv = async (_id, _cwd, _bin, args, _env, opts) => {
    const ref = args.at(-1);
    pulled.push(ref);
    const { rc, out } = script(ref, pulled.filter((r) => r === ref).length);
    opts?.capture?.push(out || "");
    return rc;
  };
  return {
    pulled,
    published,
    result: pullWithUniversalHealing({
      deploymentId: "d_test",
      workdir: ".",
      initialTag,
      projectName: "demo",
      publish: (_id, m) => published.push(m.text),
      runStep: async () => 1,
      runArgv,
    }),
  };
}

const TOO_MANY =
  'Error response from daemon: unknown: failed to resolve reference "docker.io/library/nginx:alpine": unexpected status from HEAD request to https://registry-1.docker.io/v2/library/nginx/manifests/alpine: 429 Too Many Requests';
const NOT_FOUND = "Error response from daemon: manifest for nginx:nope not found: manifest unknown";

test("which failures mean 'try again' and which mean 'not there'", () => {
  for (const transient of [
    TOO_MANY,
    "Get https://registry-1.docker.io/v2/: net/http: TLS handshake timeout",
    "dial tcp 127.0.0.1:5000: connect: connection refused",
    "error pulling image configuration: unexpected EOF",
    "toomanyrequests: You have reached your pull rate limit",
    "received unexpected HTTP status: 503 Service Unavailable",
  ])
    assert.equal(isTransientPullFailure(transient), true, transient);
  for (const definite of [
    NOT_FOUND,
    "pull access denied for nginx/nginx, repository does not exist or may require 'docker login'",
    "denied: requested access to the resource is denied",
    "Downloading [====>] 429.1MB/500MB",
    "",
  ])
    assert.equal(isTransientPullFailure(definite), false, definite);
});

test("a rate-limited registry is retried on the same image and then it works", async () => {
  const { result, pulled } = run((ref, n) =>
    n < 3 ? { rc: 1, out: TOO_MANY } : { rc: 0, out: "Status: Downloaded" },
  );
  assert.deepEqual(await result, { ok: true, tag: "nginx:alpine" });
  assert.deepEqual(pulled, ["nginx:alpine", "nginx:alpine", "nginx:alpine"]);
});

test("when the registry keeps failing, no other publisher's image is tried", async () => {
  const { result, pulled, published } = run(() => ({ rc: 1, out: TOO_MANY }));
  const r = await result;
  assert.equal(r.ok, false);
  assert.equal(r.transient, true);
  assert.ok(
    pulled.every((ref) => ref === "nginx:alpine"),
    `only the requested image was tried, not: ${pulled.filter((r) => r !== "nginx:alpine")}`,
  );
  assert.equal(pulled.length, 3, "the first try and two retries");
  assert.ok(published.some((m) => /NOT tried|Other images are NOT tried/.test(m)));
  assert.ok(!pulled.some((ref) => /linuxserver|bitnami/.test(ref)));
});

test("a missing explicit registry image fails closed without trying another publisher", async () => {
  const requested = "registry.example:5000/critical/private-web:release-2026";
  const { result, pulled, published } = run(() => ({ rc: 1, out: NOT_FOUND }), requested);
  const r = await result;
  assert.equal(r.ok, false);
  assert.deepEqual(pulled, [requested]);
  assert.ok(
    published.some((m) => /Substitution is disabled/.test(m)),
    "the exact image failure is reported without silently substituting an image",
  );
});

test("explicit references never use fuzzy registry discovery, even when enabled", async () => {
  const requested = "registry.example:5000/critical/private-web:release-2026";
  const oldDiscovery = process.env.HOSTERAX_IMAGE_DISCOVERY;
  const oldFetch = globalThis.fetch;
  process.env.HOSTERAX_IMAGE_DISCOVERY = "1";
  globalThis.fetch = async () => {
    throw new Error("the Docker Hub search must not run for an explicit reference");
  };
  try {
    const { result, pulled, published } = run(() => ({ rc: 1, out: NOT_FOUND }), requested);
    const resolved = await result;
    assert.equal(resolved.ok, false);
    assert.deepEqual(pulled, [requested]);
    assert.ok(published.some((line) => /Substitution is disabled/.test(line)));
    assert.ok(!published.some((line) => /Querying Docker Hub/.test(line)));
  } finally {
    if (oldDiscovery === undefined) delete process.env.HOSTERAX_IMAGE_DISCOVERY;
    else process.env.HOSTERAX_IMAGE_DISCOVERY = oldDiscovery;
    globalThis.fetch = oldFetch;
  }
});

test("the requested image succeeding says nothing about substitution", async () => {
  const { result, published } = run(() => ({ rc: 0, out: "ok" }));
  assert.deepEqual(await result, { ok: true, tag: "nginx:alpine" });
  assert.ok(!published.some((m) => /⚠/.test(m)));
});

test("a tag the user chose is kept exactly; only bare names are replaced by their usual image", () => {
  // bare names
  assert.equal(normalizeImageSource("nginx", "x"), "nginx:alpine");
  assert.equal(normalizeImageSource("uptime-kuma", "x"), "louislam/uptime-kuma:latest");
  assert.equal(normalizeImageSource("vaultwarden", "x"), "vaultwarden/server:latest");
  assert.equal(normalizeImageSource("vaultwarden:latest", "x"), "vaultwarden/server:latest");
  assert.equal(normalizeImageSource("something-unknown", "x"), "something-unknown:latest");
  assert.equal(normalizeImageSource("owner/name", "x"), "owner/name:latest");
  // a choice is respected: these used to become postgres:alpine, redis:alpine and mysql:8.4, which can
  // change the major version under an existing database volume
  for (const ref of [
    "postgres:16-alpine",
    "redis:7.2",
    "mysql:8.0",
    "nginx:1.27",
    "ghcr.io/org/app:2",
    "registry.local:5000/team/app:3.1",
    `nginx@sha256:${"a".repeat(64)}`,
  ])
    assert.equal(normalizeImageSource(ref, "x"), ref, ref);
  // a tag equal to the project's own name means "no tag chosen"
  assert.equal(normalizeImageSource("myimage:myproject", "myproject"), "myimage:latest");
  assert.equal(normalizeImageSource("  nginx  ", "x"), "nginx:alpine");
});

test("the image that was asked for is the first one tried, before any guess", () => {
  for (const ref of [
    "demo:1.0",
    "redis:7.2",
    "postgres:16-alpine",
    "myorg/app:3",
    "ghcr.io/org/app:2",
  ])
    assert.equal(generateCandidateImageTags(ref, "p")[0], ref, ref);
  for (const ref of [
    "demo:1.0",
    "registry.local:5000/team/app:3.1",
    "ghcr.io/org/private-app",
    `nginx@sha256:${"a".repeat(64)}`,
  ])
    assert.deepEqual(generateCandidateImageTags(ref, "different-project"), [ref], ref);
  assert.ok(
    !generateCandidateImageTags("demo:1.0", "p")
      .slice(0, 1)
      .some((r) => r.includes("linuxserver")),
  );
});

test("something that is not an image reference is never handed to docker", async () => {
  const { result, pulled } = run(() => ({ rc: 1, out: NOT_FOUND }), "a b;rm -rf /");
  await result;
  assert.ok(
    pulled.every((r) => isSafeImageRef(r)),
    `unsafe: ${pulled.filter((r) => !isSafeImageRef(r))}`,
  );
});
