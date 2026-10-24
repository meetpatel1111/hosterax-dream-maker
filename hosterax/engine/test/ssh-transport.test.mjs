// Tests for the SSH transport against a REAL OpenSSH server on loopback (see helpers/ssh-fixture.mjs).
// Only the "remote Docker" is a stand-in. They are skipped where OpenSSH is not installed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SshTransport,
  parseHostKeys,
  fingerprintOf,
  parseProbe,
  classifySshFailure,
  validateSshTarget,
} from "../src/ssh-transport.mjs";
import { startSshFixture, sshToolsAvailable } from "./helpers/ssh-fixture.mjs";

const HAVE_SSH = sshToolsAvailable();
const skip = HAVE_SSH ? false : "OpenSSH client/server is not installed";

let fx;
let home;
let transport;
let hostKey; // the pinned "type base64" string
let hostFp;

before(async () => {
  home = mkdtempSync(join(tmpdir(), "hx-ssh-home-"));
  transport = new SshTransport({ HOME: home });
  if (!HAVE_SSH) return;
  fx = await startSshFixture();
});
after(async () => {
  await transport?.stopAll();
  await fx?.stop();
  rmSync(home, { recursive: true, force: true });
});

const target = (over = {}) => ({
  id: "srv_test0001",
  host: fx.host,
  port: fx.port,
  username: fx.username,
  privateKey: fx.clientKey,
  hostKey,
  ...over,
});

// ── pure parsing: no SSH needed ───────────────────────────────────────────────────────────────

test(
  "fingerprints match ssh-keygen, and a key whose declared type disagrees with its blob is dropped",
  {
    skip,
  },
  async () => {
    const keys = await transport.scanHostKeys(fx.host, fx.port);
    assert.ok(keys.length >= 1);
    const ed = keys.find((k) => k.type === "ssh-ed25519");
    assert.ok(ed, "an ed25519 key is offered");
    // ssh-keygen is the reference implementation of the fingerprint.
    const ref = spawnSync("ssh-keygen", ["-lf", `${fx.hostKeyFile}.pub`], { encoding: "utf8" });
    assert.equal(ref.stdout.split(/\s+/)[1], ed.fingerprint);
    assert.equal(fingerprintOf(ed.key), ed.fingerprint);
    hostKey = `${ed.type} ${ed.key}`;
    hostFp = ed.fingerprint;

    const lie = parseHostKeys(`host ssh-rsa ${ed.key}\nhost ecdsa-sha2-nistp256 ${ed.key}`);
    assert.deepEqual(lie, [], "blob says ed25519 but the line claims another type");
    assert.deepEqual(parseHostKeys("# comment\nhost ssh-ed25519 not*base64"), []);
  },
);

test("parseProbe reads the report; classifySshFailure names the common failures", () => {
  const info = parseProbe(
    "HX_OS=Linux\nHX_MACHINE=x86_64\nHX_USER=deploy\nHX_CPUS=4\nHX_MEM_MB=7900\nHX_DISK_PCT=41\nHX_LOAD=0.25\nHX_DOCKER=ok\nHX_DOCKER_VERSION=27.0.1\nHX_CONTAINERS=3\n",
  );
  assert.equal(info.cpuCores, 4);
  assert.equal(info.totalRamMb, 7900);
  assert.equal(info.dockerVersion, "27.0.1");
  assert.equal(info.containers, 3);
  assert.equal(parseProbe("garbage").cpuCores, null, "missing values are null, never invented");

  const code = (s, o) => classifySshFailure(s, o).code;
  assert.equal(code("Host key verification failed."), "host_key_mismatch");
  assert.equal(code("deploy@h: Permission denied (publickey)."), "auth_failed");
  assert.equal(code("ssh: connect to host h port 22: Connection refused"), "refused");
  assert.equal(code("ssh: Could not resolve hostname nope: Name or service not known"), "dns");
  assert.equal(code("Load key: incorrect passphrase supplied to decrypt private key"), "bad_key");
  assert.equal(code("", { timedOut: true }), "timeout");
});

test("values that would be written into an ssh config are validated", () => {
  const ok = { host: "deploy.example.com", port: 22, username: "deploy" };
  assert.deepEqual(validateSshTarget(ok), ok);
  assert.throws(
    () => validateSshTarget({ ...ok, username: "deploy\n  ProxyCommand evil" }),
    /username/,
  );
  assert.throws(() => validateSshTarget({ ...ok, username: "a b" }), /username/);
  assert.throws(() => validateSshTarget({ ...ok, host: "-oProxyCommand=touch /tmp/x" }), /host/);
  assert.throws(() => validateSshTarget({ ...ok, host: "a.example.com\nHost *" }), /host/);
  assert.throws(() => validateSshTarget({ ...ok, host: "" }), /host/);
  assert.throws(() => validateSshTarget({ ...ok, port: 0 }), /port/);
  assert.throws(() => validateSshTarget({ ...ok, port: "22; id" }), /port/);
});

// ── a real SSH server ─────────────────────────────────────────────────────────────────────────

test("probe: nothing connects until a host key has been pinned", { skip }, async () => {
  const res = await transport.probe(target({ hostKey: undefined }));
  assert.equal(res.ok, false);
  assert.equal(res.code, "no_host_key");
});

test(
  "probe: with the pinned key and a valid client key it reports the server",
  { skip },
  async () => {
    const res = await transport.probe(target());
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.info.os, "Linux");
    assert.equal(res.info.docker, "ok");
    assert.equal(res.info.dockerVersion, "27.0.1-fake");
    assert.equal(res.info.containers, 2);
    assert.ok(res.info.cpuCores >= 1);
    assert.ok(res.latencyMs >= 0);
  },
);

test(
  "the key file is private and the generated config pins the host key and refuses everything else",
  {
    skip,
  },
  async () => {
    const { keyPath, configPath, knownHosts, dir } = transport.prepare(target());
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    const cfg = readFileSync(configPath, "utf8");
    for (const must of [
      "StrictHostKeyChecking yes",
      "BatchMode yes",
      "PasswordAuthentication no",
      "IdentitiesOnly yes",
      "IdentityAgent none",
      "ForwardAgent no",
      "GlobalKnownHostsFile /dev/null",
    ])
      assert.ok(cfg.includes(must), `config has ${must}`);
    assert.ok(readFileSync(knownHosts, "utf8").includes(hostKey));
  },
);

test("probe: a host key that changes is refused and nothing is sent", { skip }, async () => {
  // Another machine answering on the same address. The pinned key must not match.
  const other = await startSshFixture();
  try {
    const res = await transport.probe(
      target({
        id: "srv_test0002",
        host: other.host,
        port: other.port,
        privateKey: other.clientKey,
      }),
    );
    assert.equal(res.ok, false);
    assert.equal(res.code, "host_key_mismatch", JSON.stringify(res));
    assert.equal(other.daemonRequests.length, 0);
  } finally {
    await other.stop();
  }
});

test("probe: the same server after a host key change is refused too", { skip }, async () => {
  const fx2 = await startSshFixture();
  try {
    const keys = await transport.scanHostKeys(fx2.host, fx2.port);
    const pinned = `${keys[0].type} ${keys[0].key}`;
    const t = target({
      id: "srv_test0003",
      host: fx2.host,
      port: fx2.port,
      privateKey: fx2.clientKey,
      hostKey: pinned,
    });
    assert.equal((await transport.probe(t)).ok, true);
    fx2.regenerateHostKey();
    await new Promise((r) => setTimeout(r, 400));
    await transport.closeMaster(t.id); // drop the multiplexed connection that still carries the old session
    const res = await transport.probe(t);
    assert.equal(res.ok, false);
    assert.equal(res.code, "host_key_mismatch", JSON.stringify(res));
  } finally {
    await fx2.stop();
  }
});

test("probe: a key the server does not know is rejected as auth_failed", { skip }, async () => {
  const stranger = transport.generateKeyPair();
  const res = await transport.probe(
    target({ id: "srv_test0004", privateKey: stranger.privateKey }),
  );
  assert.equal(res.ok, false);
  assert.equal(res.code, "auth_failed", JSON.stringify(res));
});

test("probe: Docker permission and daemon problems are reported with a fix", { skip }, async () => {
  fx.dockerMode("denied");
  let res = await transport.probe(target());
  assert.equal(res.code, "docker_denied");
  assert.match(res.message, /docker group/);
  fx.dockerMode("down");
  res = await transport.probe(target());
  assert.equal(res.code, "docker_down");
  fx.dockerMode("ok");
  assert.equal((await transport.probe(target())).ok, true);
});

test("probe: a server that is not listening says so", { skip }, async () => {
  const res = await transport.probe(target({ id: "srv_test0005", port: 1 }));
  assert.equal(res.ok, false);
  assert.ok(["refused", "unreachable"].includes(res.code), JSON.stringify(res));
});

test("a private key protected by a passphrase is refused with an explanation", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "hx-pp-"));
  try {
    const f = join(dir, "k");
    spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "secret-pass", "-f", f]);
    assert.throws(() => transport.derivePublicKey(readFileSync(f, "utf8")), /passphrase/);
    assert.throws(() => transport.derivePublicKey("not a key"), /could not be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generated and pasted keys give the same public key", { skip }, () => {
  const { privateKey, publicKey } = transport.generateKeyPair("hosterax");
  assert.match(publicKey, /^ssh-ed25519 \S+ hosterax$/);
  assert.equal(
    transport.derivePublicKey(privateKey).split(" ").slice(0, 2).join(" "),
    publicKey.split(" ").slice(0, 2).join(" "),
  );
});

test("the Docker bridge speaks HTTP to the server's Docker through ssh", { skip }, async () => {
  const t = target();
  const bridge = await transport.startBridge(t);
  assert.equal(statSync(bridge.socketPath).mode & 0o777, 0o600);
  const get = (p) =>
    new Promise((resolve, reject) => {
      http
        .get({ socketPath: bridge.socketPath, path: p }, (res) => {
          let b = "";
          res.on("data", (d) => (b += d));
          res.on("end", () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
        })
        .on("error", reject);
    });
  const ping = await get("/_ping");
  assert.equal(ping.status, 200);
  assert.equal(ping.body, "OK");
  // Several at once: each is its own ssh session over the shared connection.
  const many = await Promise.all(Array.from({ length: 8 }, () => get("/version")));
  for (const r of many) assert.equal(JSON.parse(r.body).Version, "27.0.1-fake");
  assert.equal(transport.dockerEnv(t.id).DOCKER_HOST, `unix://${bridge.socketPath}`);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(transport.bridgeStatus(t.id).totalConnections >= 8);
});

test(
  "the real Docker CLI works through the bridge (DOCKER_HOST only)",
  {
    skip:
      HAVE_SSH && spawnSync("docker", ["--version"]).status === 0
        ? false
        : "docker CLI not installed",
  },
  async () => {
    const t = target();
    if (!transport.bridges.has(t.id)) await transport.startBridge(t);
    const env = { PATH: process.env.PATH, HOME: home, ...transport.dockerEnv(t.id) };
    const v = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      env,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(v.stdout.trim(), "27.0.1-fake", v.stderr);
    const ps = spawnSync("docker", ["ps", "-q"], { env, encoding: "utf8", timeout: 30000 });
    assert.equal(ps.status, 0, ps.stderr);
    assert.ok(fx.daemonRequests.some((r) => r.includes("/containers/json")));
  },
);

test(
  "when ssh cannot connect, the bridge closes the connection and records why",
  { skip },
  async () => {
    await transport.stopBridge("srv_test0001");
    fx.dockerMode("down");
    const t = target();
    const bridge = await transport.startBridge(t);
    const res = await new Promise((resolve) => {
      http
        .get({ socketPath: bridge.socketPath, path: "/_ping" }, (r) =>
          resolve({ status: r.statusCode }),
        )
        .on("error", (err) => resolve({ error: err.code }));
    });
    assert.ok(res.error, "the request fails instead of hanging");
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(transport.bridgeStatus(t.id).lastFailure, "the reason is recorded");
    fx.dockerMode("ok");
  },
);

test("forgetting a server removes its key, config and socket", { skip }, async () => {
  const t = target();
  const { dir, keyPath } = transport.prepare(t);
  await transport.startBridge(t);
  await transport.forget(t.id);
  assert.equal(existsSync(keyPath), false);
  assert.equal(existsSync(dir), false);
  assert.equal(transport.bridges.has(t.id), false);
});

test("unsupported platforms say so", () => {
  const w = new SshTransport({ HOME: home, platform: "win32" });
  assert.match(w.unsupportedReason, /Windows/);
  assert.throws(
    () => w.prepare({ id: "srv_x", host: "h.example.com", port: 22, username: "u" }),
    /Windows/,
  );
});

// Kept last: it writes a file into the scratch HOME that other tests do not look at.
test("an ssh binary that is missing is reported, not thrown", { skip }, async () => {
  const t2 = new SshTransport({
    HOME: home,
    env: { ...process.env, HOSTERAX_SSH_PATH: "/nonexistent/ssh" },
  });
  const res = await t2.probe(target());
  assert.equal(res.ok, false);
  assert.equal(res.code, "no_ssh_client");
  writeFileSync(join(home, "done"), "1");
});
