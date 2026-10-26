import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import {
  runOnServer,
  currentServerId,
  configureDockerScope,
  spawn,
  spawnSync,
  execFile,
  onServer,
} from "../src/docker-scope.mjs";
import { spawnSync as boundedSpawnSync } from "../src/safe-exec.mjs";

const skip = process.platform === "win32" ? "needs a shell script named docker" : false;
let dir;
let savedPath;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "hx-scope-"));
  // A stand-in `docker` that reports the Docker environment it was started with.
  writeFileSync(
    join(dir, "docker"),
    '#!/bin/sh\necho "host=${DOCKER_HOST-unset} ctx=${DOCKER_CONTEXT-unset} tls=${DOCKER_TLS_VERIFY-unset} keep=${KEEP_ME-unset}"\n',
  );
  chmodSync(join(dir, "docker"), 0o755);
  savedPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${savedPath}`;
  configureDockerScope({
    dockerEnv: (id) => {
      if (id === "down") throw new Error('Server "down" is not connected.');
      return { DOCKER_HOST: `unix:///run/hx/${id}.sock` };
    },
  });
});
after(() => {
  process.env.PATH = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

const out = (r) => String(r.stdout).trim();
const dirty = {
  ...process.env,
  DOCKER_HOST: "tcp://elsewhere:2375",
  DOCKER_CONTEXT: "prod",
  DOCKER_TLS_VERIFY: "1",
  KEEP_ME: "yes",
};

test("outside any scope, docker runs exactly as before", { skip }, () => {
  const r = spawnSync("docker", [], { encoding: "utf8", env: dirty });
  assert.equal(out(r), "host=tcp://elsewhere:2375 ctx=prod tls=1 keep=yes");
  assert.equal(currentServerId(), null);
});

test(
  "inside a remote scope, docker is pointed at that server and stale Docker settings are dropped",
  {
    skip,
  },
  async () => {
    await runOnServer("srv_a", async () => {
      assert.equal(currentServerId(), "srv_a");
      // every call shape the engine uses
      assert.equal(
        out(spawnSync("docker", [], { encoding: "utf8", env: dirty })),
        "host=unix:///run/hx/srv_a.sock ctx=unset tls=unset keep=yes",
      );
      assert.match(
        out(spawnSync("docker", [], { encoding: "utf8" })),
        /^host=unix:\/\/\/run\/hx\/srv_a\.sock/,
      );
      assert.match(
        out(boundedSpawnSync("docker", ["x"], { encoding: "utf8" })),
        /^host=unix:\/\/\/run\/hx\/srv_a\.sock/,
      );
      const viaSpawn = await new Promise((resolve) => {
        const c = spawn("docker", ["x"]);
        let s = "";
        c.stdout.on("data", (d) => (s += d));
        c.on("close", () => resolve(s.trim()));
      });
      assert.match(viaSpawn, /^host=unix:\/\/\/run\/hx\/srv_a\.sock/);
      for (const call of [
        (cb) => execFile("docker", cb),
        (cb) => execFile("docker", ["x"], cb),
        (cb) => execFile("docker", ["x"], { encoding: "utf8", timeout: 5000 }, cb),
        (cb) => execFile("docker", { encoding: "utf8" }, cb),
      ]) {
        const s = await new Promise((resolve, reject) =>
          call((err, stdout) => (err ? reject(err) : resolve(String(stdout).trim()))),
        );
        assert.match(s, /^host=unix:\/\/\/run\/hx\/srv_a\.sock/);
      }
      // other programs are never touched
      const node = spawnSync(
        process.execPath,
        ["-e", "console.log(process.env.DOCKER_HOST ?? 'unset')"],
        {
          encoding: "utf8",
          env: dirty,
        },
      );
      assert.equal(out(node), "tcp://elsewhere:2375");
      // work started in the scope and awaited keeps it
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(currentServerId(), "srv_a");
    });
    assert.equal(currentServerId(), null, "the scope ends with the work");
  },
);

test("scopes do not leak between concurrent jobs, and nest", { skip }, async () => {
  const seen = [];
  await Promise.all([
    runOnServer("srv_a", async () => {
      await new Promise((r) => setTimeout(r, 20));
      seen.push(["a", out(spawnSync("docker", [], { encoding: "utf8" }))]);
    }),
    runOnServer("srv_b", async () => {
      seen.push(["b", out(spawnSync("docker", [], { encoding: "utf8" }))]);
    }),
    (async () => {
      seen.push(["local", out(spawnSync("docker", [], { encoding: "utf8", env: dirty }))]);
    })(),
  ]);
  const by = Object.fromEntries(seen);
  assert.match(by.a, /srv_a\.sock/);
  assert.match(by.b, /srv_b\.sock/);
  assert.match(by.local, /host=tcp:\/\/elsewhere/);

  await runOnServer("srv_a", async () => {
    await runOnServer("local", async () => {
      assert.equal(currentServerId(), null);
      assert.match(
        out(spawnSync("docker", [], { encoding: "utf8", env: dirty })),
        /host=tcp:\/\/elsewhere/,
      );
    });
    assert.equal(currentServerId(), "srv_a");
  });
});

test(
  "a server that is not connected makes the docker call fail instead of falling back to this machine",
  {
    skip,
  },
  async () => {
    await runOnServer("down", async () => {
      assert.throws(() => spawnSync("docker", [], { encoding: "utf8" }), /not connected/);
      assert.throws(() => spawn("docker", []), /not connected/);
      assert.throws(() => execFile("docker", [], () => {}), /not connected/);
    });
  },
);

test("onServer wraps a function so each call runs on the server it names", { skip }, async () => {
  const f = onServer(
    (project) => (project === "remote-app" ? "srv_a" : null),
    async (project) => out(spawnSync("docker", [], { encoding: "utf8", env: dirty })),
  );
  assert.match(await f("remote-app"), /srv_a\.sock/);
  assert.match(await f("local-app"), /host=tcp:\/\/elsewhere/);
});
