// The command line for remote servers, against a real engine and a real OpenSSH server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHarness } from "./helpers/engine-harness.mjs";
import { startSshFixture, sshToolsAvailable } from "./helpers/ssh-fixture.mjs";

const skip = sshToolsAvailable() ? false : "OpenSSH client/server is not installed";
const CLI = fileURLToPath(new URL("../../cli/src/cli.mjs", import.meta.url));
const h = createHarness("hosterax-servers-cli-");
let fx;
let engine;

const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOSTERAX_URL: engine.base,
      HOSTERAX_TOKEN: engine.bootstrap,
      HOME: h.scratch, // keep the CLI's saved config out of the real home
    },
    input: "",
    timeout: 60000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

before(async () => {
  if (skip) return;
  fx = await startSshFixture();
  engine = await h.startEngine();
});
after(async () => {
  await h.cleanup();
  await fx?.stop();
});

let id;
test("server:add prints the public key and the next steps", { skip }, () => {
  const r = cli(
    "server:add",
    "Lab",
    "--host",
    fx.host,
    "--port",
    String(fx.port),
    "--user",
    fx.username,
  );
  assert.equal(r.code, 0, r.err);
  id = /\((srv_[0-9a-f]+)\)/.exec(r.out)?.[1];
  assert.ok(id, r.out);
  const pub = /(ssh-ed25519 \S+ hosterax)/.exec(r.out)?.[1];
  assert.ok(pub, "the public key is shown");
  fx.authorizeKey(pub);
  assert.match(r.out, new RegExp(`server:trust ${id}`));
});

test("server:test refuses to connect before the host key is confirmed", { skip }, () => {
  const r = cli("server:test", id);
  assert.equal(r.code, 1);
  assert.match(r.out, /no_host_key|Confirm the server's host key/);
});

test("server:trust shows the fingerprints and does nothing without a yes", { skip }, () => {
  const declined = cli("server:trust", id); // stdin is empty: no confirmation
  assert.equal(declined.code, 1);
  assert.match(declined.out, /SHA256:/);
  assert.match(declined.out, /Not confirmed/);
  assert.match(cli("servers").out, /NOT CONFIRMED/);
});

test("server:trust --fingerprint pins it; server:test then connects", { skip }, () => {
  const fp = /(SHA256:\S+)/.exec(cli("server:trust", id).out)?.[1];
  const wrong = cli("server:trust", id, "--fingerprint", "SHA256:" + "B".repeat(43));
  assert.equal(wrong.code, 1);
  assert.match(wrong.err, /does not present a key with that fingerprint/);
  const ok = cli("server:trust", id, "--fingerprint", fp);
  assert.equal(ok.code, 0, ok.err);
  const t = cli("server:test", id);
  assert.equal(t.code, 0, t.out + t.err);
  assert.match(t.out, /Docker v27\.0\.1-fake/);
  const list = cli("servers").out;
  assert.match(list, /Lab/);
  assert.match(list, /confirmed/);
  assert.match(list, /online/);
});

test(
  "server:bootstrap prints a script that authorises the key; server:rm removes the server",
  { skip },
  () => {
    const sh = cli("server:bootstrap", id).out;
    assert.match(sh, /authorized_keys/);
    assert.equal(cli("server:rm", id).code, 0);
    assert.doesNotMatch(cli("servers").out, /Lab/);
  },
);
