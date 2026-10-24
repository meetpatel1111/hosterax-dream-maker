import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectDockerHost, DockerApiClient } from "../src/docker-api.mjs";

const home = "/home/me";
const base = { env: {}, platform: "linux", home, uid: 1000 };
const contextSays =
  (host, status = 0) =>
  () => ({ stdout: `${host}\n`, status });
const present =
  (...paths) =>
  (p) =>
    paths.includes(p);

test("DOCKER_HOST wins over everything", () => {
  const d = detectDockerHost({
    ...base,
    env: { DOCKER_HOST: "tcp://10.0.0.5:2376" },
    run: contextSays("unix:///ignored.sock"),
    exists: present("/var/run/docker.sock"),
  });
  assert.deepEqual([d.host, d.port, d.source], ["10.0.0.5", 2376, "DOCKER_HOST"]);
  assert.equal(
    detectDockerHost({ ...base, env: { DOCKER_HOST: "unix:///custom.sock" } }).socketPath,
    "/custom.sock",
  );
});

test("the CLI's current context decides: Colima, Rancher Desktop and OrbStack are found without any setup", () => {
  for (const sock of [
    `${home}/.colima/default/docker.sock`,
    `${home}/.rd/docker.sock`,
    `${home}/.orbstack/run/docker.sock`,
  ]) {
    const d = detectDockerHost({
      ...base,
      run: contextSays(`unix://${sock}`),
      // /var/run/docker.sock exists too (a stale Docker Desktop link): the context still wins
      exists: present(sock, "/var/run/docker.sock"),
    });
    assert.equal(d.socketPath, sock);
    assert.equal(d.source, "docker context");
  }
});

test("a context pointing at a missing socket, or one we cannot speak to, falls back to what exists", () => {
  const colima = `${home}/.colima/default/docker.sock`;
  const gone = detectDockerHost({
    ...base,
    run: contextSays("unix:///not/there.sock"),
    exists: present(colima),
  });
  assert.deepEqual([gone.socketPath, gone.source], [colima, "known socket"]);
  const ssh = detectDockerHost({
    ...base,
    run: contextSays("ssh://deploy@vps.example.com"),
    exists: present("/var/run/docker.sock"),
  });
  assert.equal(
    ssh.socketPath,
    "/var/run/docker.sock",
    "the CLI can use ssh contexts; the native client cannot",
  );
  const failed = detectDockerHost({
    ...base,
    run: contextSays("unix:///x.sock", 1),
    exists: present("/var/run/docker.sock"),
  });
  assert.equal(failed.source, "known socket");
  const tcp = detectDockerHost({
    ...base,
    run: contextSays("tcp://192.168.1.9:2375"),
    exists: () => false,
  });
  assert.deepEqual([tcp.host, tcp.port], ["192.168.1.9", 2375]);
});

test("without a context, known locations are tried in order, including rootless Docker and Podman", () => {
  const run = () => {
    throw new Error("docker is not installed");
  };
  const order = [
    ["/var/run/docker.sock"],
    [`${home}/.docker/run/docker.sock`],
    [`${home}/.colima/default/docker.sock`],
    ["/run/user/1000/docker.sock"],
    ["/run/user/1000/podman/podman.sock"],
    ["/run/podman/podman.sock"],
  ];
  for (const [sock] of order)
    assert.equal(detectDockerHost({ ...base, run, exists: present(sock) }).socketPath, sock);
  // the first match wins
  assert.equal(
    detectDockerHost({
      ...base,
      run,
      exists: present(`${home}/.docker/run/docker.sock`, "/run/podman/podman.sock"),
    }).socketPath,
    `${home}/.docker/run/docker.sock`,
  );
  assert.equal(
    detectDockerHost({
      ...base,
      env: { XDG_RUNTIME_DIR: "/tmp/xdg" },
      run,
      exists: present("/tmp/xdg/docker.sock"),
    }).socketPath,
    "/tmp/xdg/docker.sock",
  );
  const none = detectDockerHost({ ...base, run, exists: () => false });
  assert.deepEqual([none.socketPath, none.source], ["/var/run/docker.sock", "default"]);
});

test("Windows uses the named pipe, and the client reports where it is looking", () => {
  const w = detectDockerHost({ ...base, platform: "win32" });
  assert.equal(w.socketPath, "\\\\.\\pipe\\docker_engine");
  const c = new DockerApiClient({ socketPath: "/tmp/x.sock" });
  assert.equal(c.description, "unix:///tmp/x.sock");
  assert.equal(c.source, "explicit");
});

test(
  "with the real docker CLI lookup: a stub `docker` is asked, and a slow one cannot stall startup",
  { skip: process.platform === "win32" },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hx-detect-"));
    try {
      const sock = path.join(dir, "colima.sock");
      fs.writeFileSync(sock, "");
      const stub = path.join(dir, "docker");
      fs.writeFileSync(stub, `#!/bin/sh\necho "unix://${sock}"\n`, { mode: 0o755 });
      const env = { PATH: `${dir}:${process.env.PATH}` };
      const saved = process.env.PATH;
      process.env.PATH = env.PATH;
      try {
        const d = detectDockerHost({ env, platform: "linux", home: dir, uid: 1 });
        assert.deepEqual([d.socketPath, d.source], [sock, "docker context"]);

        fs.writeFileSync(stub, "#!/bin/sh\nsleep 6\n", { mode: 0o755 });
        const t0 = Date.now();
        const slow = detectDockerHost({
          env,
          platform: "linux",
          home: dir,
          uid: 1,
          exists: () => false,
        });
        assert.ok(Date.now() - t0 < 4000, "bounded");
        assert.equal(slow.source, "default");
      } finally {
        process.env.PATH = saved;
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
