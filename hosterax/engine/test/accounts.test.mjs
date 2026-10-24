import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initSecrets } from "../src/secrets.mjs";
import { AccountManager, AccountError, scopesForRole } from "../src/accounts.mjs";
import { base32Decode, base32Encode, hotp, totp, verifyTotp, otpauthUri } from "../src/totp.mjs";

initSecrets(fs.mkdtempSync(path.join(os.tmpdir(), "hosterax-accounts-")));

// ───────────────────────── TOTP ─────────────────────────

test("TOTP matches the RFC 6238 test vectors", () => {
  const secret = Buffer.from("12345678901234567890", "ascii"); // SHA-1 vectors, 8 digits
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, expected] of vectors)
    assert.equal(hotp(secret, Math.floor(seconds / 30), 8), expected, `t=${seconds}`);
  // and the 6-digit form authenticator apps use
  assert.equal(totp(base32Encode(secret), 59_000), "287082");
});

test("base32 round-trips and rejects junk; codes are checked with drift and no replay", () => {
  const raw = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7, 8, 9, 10]);
  assert.ok(base32Decode(base32Encode(raw)).equals(raw));
  assert.throws(() => base32Decode("not*base32"), /invalid base32/);

  const secret = base32Encode(crypto_random(20));
  const now = Date.UTC(2026, 9, 23, 12, 0, 0);
  const code = totp(secret, now);
  const step = verifyTotp(secret, code, { now });
  assert.ok(step > 0);
  assert.ok(
    verifyTotp(secret, totp(secret, now - 30_000), { now }),
    "one step of drift is accepted",
  );
  assert.equal(verifyTotp(secret, totp(secret, now - 90_000), { now }), null, "three steps is not");
  assert.equal(
    verifyTotp(secret, code, { now, lastStep: step }),
    null,
    "the same code cannot be replayed",
  );
  assert.equal(verifyTotp(secret, "12345", { now }), null);
  assert.equal(verifyTotp(secret, "abcdef", { now }), null);
  assert.match(
    otpauthUri({ secret, account: "a@b.co" }),
    /^otpauth:\/\/totp\/HosteraX:a%40b\.co\?secret=/,
  );
});

function crypto_random(n) {
  return Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255));
}

// ───────────────────────── accounts ─────────────────────────

function setup() {
  const db = new Database(":memory:");
  let clock = Date.UTC(2026, 9, 23, 12, 0, 0);
  const accounts = new AccountManager({ db, now: () => clock });
  return {
    db,
    accounts,
    advance: (ms) => (clock += ms),
    now: () => clock,
    owner: accounts.bootstrapOwner({
      email: "owner@example.com",
      password: "correct horse battery",
    }),
  };
}

const PW = "a-long-enough-password";
const as = (user) => ({ kind: "user", user });
const SYSTEM = { kind: "system" };

test("the first account is the owner, once", () => {
  const { accounts, owner } = setup();
  assert.equal(owner.role, "owner");
  assert.throws(() => accounts.bootstrapOwner({ email: "x@example.com", password: PW }), /already/);
  assert.throws(() => accounts.createUser(SYSTEM, { email: "bad", password: PW }), /valid email/);
  assert.throws(
    () => accounts.createUser(SYSTEM, { email: "a@example.com", password: "short" }),
    /at least 10/,
  );
  assert.throws(
    () => accounts.createUser(SYSTEM, { email: "OWNER@example.com", password: PW }),
    (e) => e.status === 409,
  );
  assert.deepEqual(scopesForRole("viewer"), ["read"]);
  assert.deepEqual(scopesForRole("developer"), ["deploy"]);
  assert.deepEqual(scopesForRole("admin"), ["admin"]);
  assert.deepEqual(scopesForRole("owner"), ["*"]);
});

test("roles limit who can create, change and delete whom", () => {
  const { accounts, owner } = setup();
  const admin = accounts.createUser(as(owner), {
    email: "admin@example.com",
    role: "admin",
    password: PW,
  });
  const dev = accounts.createUser(as(admin), {
    email: "dev@example.com",
    role: "developer",
    password: PW,
  });
  const viewer = accounts.createUser(as(admin), {
    email: "view@example.com",
    role: "viewer",
    password: PW,
  });

  // an admin cannot mint admins or owners, nor touch them
  for (const role of ["admin", "owner"])
    assert.throws(
      () => accounts.createUser(as(admin), { email: `${role}2@example.com`, role, password: PW }),
      (e) => e.status === 403,
    );
  assert.throws(
    () => accounts.updateUser(as(admin), owner.id, { name: "x" }),
    (e) => e.status === 403,
  );
  assert.throws(
    () => accounts.updateUser(as(admin), dev.id, { role: "admin" }),
    (e) => e.status === 403,
  );
  assert.throws(
    () => accounts.deleteUser(as(admin), owner.id),
    (e) => e.status === 403,
  );
  assert.equal(accounts.updateUser(as(admin), dev.id, { role: "viewer" }).role, "viewer");

  // developers and viewers manage nobody
  assert.throws(
    () => accounts.createUser(as(dev), { email: "z@example.com", password: PW }),
    (e) => e.status === 403,
  );
  assert.throws(
    () => accounts.updateUser(as(viewer), dev.id, { name: "x" }),
    (e) => e.status === 403,
  );
  // ...but anyone may rename themselves, and nothing more
  assert.equal(accounts.updateUser(as(viewer), viewer.id, { name: "Vee" }).name, "Vee");
  assert.throws(
    () => accounts.updateUser(as(viewer), viewer.id, { role: "owner" }),
    (e) => e.status === 403,
  );

  // the system actor (admin API token / local machine) may do anything
  assert.equal(accounts.updateUser(SYSTEM, viewer.id, { role: "admin" }).role, "admin");
});

test("there is always at least one active owner", () => {
  const { accounts, owner } = setup();
  for (const attempt of [
    () => accounts.updateUser(SYSTEM, owner.id, { role: "admin" }),
    () => accounts.updateUser(SYSTEM, owner.id, { disabled: true }),
    () => accounts.deleteUser(SYSTEM, owner.id),
  ])
    assert.throws(attempt, (e) => e instanceof AccountError && e.status === 409);

  const second = accounts.createUser(SYSTEM, {
    email: "o2@example.com",
    role: "owner",
    password: PW,
  });
  assert.equal(accounts.updateUser(SYSTEM, owner.id, { role: "admin" }).role, "admin");
  assert.throws(
    () => accounts.deleteUser(SYSTEM, second.id),
    (e) => e.status === 409,
  );
  assert.throws(() => accounts.deleteUser(as(second), second.id), /your own account/);
});

test("sign-in creates a session whose scopes follow the role live", () => {
  const { accounts, owner } = setup();
  const dev = accounts.createUser(SYSTEM, {
    email: "dev@example.com",
    role: "developer",
    password: PW,
  });
  const { token, user } = accounts.login({ email: "DEV@example.com", password: PW });
  assert.match(token, /^hxs_[0-9a-f]{48}$/);
  assert.equal(user.id, dev.id);
  assert.deepEqual(accounts.resolveSession(token).scopes, ["deploy"]);

  accounts.updateUser(SYSTEM, dev.id, { role: "viewer" });
  assert.deepEqual(accounts.resolveSession(token).scopes, ["read"], "demotion applies at once");

  accounts.updateUser(SYSTEM, dev.id, { disabled: true });
  assert.equal(accounts.resolveSession(token), null, "a disabled user's sessions stop working");
  assert.throws(
    () => accounts.login({ email: dev.email, password: PW }),
    /invalid email or password/,
  );

  assert.equal(accounts.resolveSession("hxs_" + "0".repeat(48)), null);
  assert.equal(accounts.resolveSession("hxt_notasession"), null);
  assert.ok(owner);
});

test("sessions expire when idle, are capped in total, and can be revoked", () => {
  const { accounts, advance } = setup();
  accounts.createUser(SYSTEM, { email: "a@example.com", role: "viewer", password: PW });
  const day = 24 * 3600000;

  let { token } = accounts.login({ email: "a@example.com", password: PW });
  advance(6 * day);
  assert.ok(accounts.resolveSession(token), "still valid just inside the idle window");
  advance(6 * day); // last use was 6 days ago — the idle window slid forward
  assert.ok(accounts.resolveSession(token), "using a session extends its idle window");
  advance(8 * day);
  assert.equal(accounts.resolveSession(token), null, "an idle session expires");

  ({ token } = accounts.login({ email: "a@example.com", password: PW }));
  for (let i = 0; i < 4; i++) {
    advance(6 * day);
    assert.ok(accounts.resolveSession(token), `active use keeps it alive (${i})`);
  }
  advance(7 * day); // 31 days after sign-in, however active it was
  assert.equal(accounts.resolveSession(token), null, "the absolute limit always applies");

  ({ token } = accounts.login({ email: "a@example.com", password: PW }));
  assert.equal(accounts.revokeSession(token), true);
  assert.equal(accounts.resolveSession(token), null);
});

test("bad credentials look the same, and repeated failures lock the email", () => {
  const { accounts, advance } = setup();
  accounts.createUser(SYSTEM, { email: "real@example.com", role: "viewer", password: PW });
  const message = (email, password) => {
    try {
      accounts.login({ email, password });
    } catch (e) {
      return `${e.status} ${e.message}`;
    }
    return "ok";
  };
  assert.equal(message("real@example.com", "wrong"), message("ghost@example.com", "wrong"));

  // one wrong attempt was made above; six more make seven
  for (let i = 0; i < 6; i++) message("real@example.com", "wrong");
  // the 8th failure locks; even the right password is refused during the lock
  assert.match(message("real@example.com", "wrong"), /^401/);
  assert.match(message("real@example.com", PW), /^429 too many failed attempts/);
  // locking does not depend on the account existing, so it cannot be used to find accounts
  for (let i = 0; i < 8; i++) message("ghost@example.com", "wrong");
  assert.match(message("ghost@example.com", "wrong"), /^429/);

  advance(16 * 60000);
  assert.equal(message("real@example.com", PW), "ok");
  assert.equal(message("real@example.com", "wrong"), "401 invalid email or password");
});

test("two-factor: setup, login with a code, no replay, recovery codes, disable, admin reset", () => {
  const { accounts, owner, advance, now } = setup();
  const u = accounts.createUser(SYSTEM, {
    email: "mfa@example.com",
    role: "developer",
    password: PW,
  });

  const { secret, otpauthUri: uri } = accounts.beginTwoFactor(u.id);
  assert.match(uri, /otpauth:\/\/totp\//);
  assert.throws(() => accounts.enableTwoFactor(u.id, "000000"), /not valid/);
  const { recoveryCodes } = accounts.enableTwoFactor(u.id, totp(secret, now()));
  assert.equal(recoveryCodes.length, 8);
  assert.throws(() => accounts.beginTwoFactor(u.id), /already on/);
  assert.equal(accounts.getUser(u.id).twoFactorEnabled, true);

  // the secret is stored encrypted
  const stored = accounts.db
    .prepare("SELECT totp_secret FROM users WHERE id=?")
    .get(u.id).totp_secret;
  assert.match(stored, /^enc:v1:/);
  assert.ok(!stored.includes(secret));

  // password alone is not enough, and says why
  assert.throws(
    () => accounts.login({ email: u.email, password: PW }),
    (e) => e.status === 401 && e.extra.twoFactorRequired === true,
  );
  assert.throws(
    () => accounts.login({ email: u.email, password: PW, code: "123456" }),
    /two-factor/,
  );

  advance(30_000); // the enabling code's step is spent; move to a fresh one
  const code = totp(secret, now());
  assert.ok(accounts.login({ email: u.email, password: PW, code }).token);
  assert.throws(
    () => accounts.login({ email: u.email, password: PW, code }),
    /two-factor/,
    "the same code cannot be used twice",
  );

  // a recovery code works once
  const recovery = recoveryCodes[0];
  assert.ok(accounts.login({ email: u.email, password: PW, code: recovery }).token);
  assert.throws(
    () => accounts.login({ email: u.email, password: PW, code: recovery }),
    /two-factor/,
  );

  // disabling needs the password and a valid code
  advance(30_000);
  assert.throws(
    () => accounts.disableTwoFactor(u.id, { password: "wrong", code: totp(secret, now()) }),
    /password/,
  );
  assert.throws(
    () => accounts.disableTwoFactor(u.id, { password: PW, code: "000000" }),
    /not valid/,
  );
  accounts.disableTwoFactor(u.id, { password: PW, code: totp(secret, now()) });
  assert.equal(accounts.getUser(u.id).twoFactorEnabled, false);
  assert.ok(accounts.login({ email: u.email, password: PW }).token);

  // an admin can recover a locked-out user, which also ends their sessions
  const s2 = accounts.beginTwoFactor(u.id);
  accounts.enableTwoFactor(u.id, totp(s2.secret, now()));
  const { token } = (() => {
    advance(30_000);
    return accounts.login({ email: u.email, password: PW, code: totp(s2.secret, now()) });
  })();
  accounts.resetTwoFactor(as(owner), u.id);
  assert.equal(accounts.resolveSession(token), null);
  assert.equal(accounts.getUser(u.id).twoFactorEnabled, false);
});

test("changing a password ends the other sessions; deleting a user ends all of them", () => {
  const { accounts } = setup();
  const u = accounts.createUser(SYSTEM, { email: "p@example.com", role: "viewer", password: PW });
  const a = accounts.login({ email: u.email, password: PW });
  const b = accounts.login({ email: u.email, password: PW });
  const keep = accounts.resolveSession(a.token).sessionId;

  assert.throws(
    () => accounts.changePassword(u.id, "wrong", "another-long-password", { keepSessionId: keep }),
    /current password/,
  );
  assert.throws(
    () => accounts.changePassword(u.id, PW, "short", { keepSessionId: keep }),
    /at least 10/,
  );
  assert.equal(
    accounts.changePassword(u.id, PW, "another-long-password", { keepSessionId: keep })
      .revokedSessions,
    1,
  );
  assert.ok(accounts.resolveSession(a.token));
  assert.equal(accounts.resolveSession(b.token), null);
  assert.throws(() => accounts.login({ email: u.email, password: PW }), /invalid/);
  assert.ok(accounts.login({ email: u.email, password: "another-long-password" }).token);

  const c = accounts.login({ email: u.email, password: "another-long-password" });
  accounts.deleteUser(SYSTEM, u.id);
  assert.equal(accounts.resolveSession(c.token), null);
  assert.equal(accounts.resolveSession(a.token), null);
});

test("SSO sign-in provisions least-privilege accounts and never grants admin", () => {
  const { accounts, owner } = setup();
  const identity = { email: "New.Person@Example.com", name: "New Person", subject: "sub-123" };
  const first = accounts.loginWithIdentity(identity, { defaultRole: "viewer" });
  assert.equal(first.user.role, "viewer");
  assert.equal(first.user.authSource, "oidc");
  assert.equal(first.user.email, "new.person@example.com");
  assert.deepEqual(accounts.resolveSession(first.token).scopes, ["read"]);

  // the same person again reuses the account
  assert.equal(
    accounts.loginWithIdentity(identity, { defaultRole: "viewer" }).user.id,
    first.user.id,
  );
  assert.equal(accounts.listUsers().length, 2);

  // an SSO-only account has no password to guess
  assert.throws(() => accounts.login({ email: "new.person@example.com", password: PW }), /invalid/);

  // an existing local account is linked by verified email, but not re-linked to someone else
  const linked = accounts.loginWithIdentity(
    { email: owner.email, name: "Owner", subject: "owner-sub" },
    { defaultRole: "viewer" },
  );
  assert.equal(linked.user.role, "owner", "linking keeps the role an owner assigned");
  assert.throws(
    () =>
      accounts.loginWithIdentity(
        { email: owner.email, name: "Mallory", subject: "other-sub" },
        { defaultRole: "viewer" },
      ),
    (e) => e.status === 403,
  );

  accounts.updateUser(SYSTEM, first.user.id, { disabled: true });
  assert.throws(() => accounts.loginWithIdentity(identity, { defaultRole: "viewer" }), /disabled/);
  for (const role of ["admin", "owner"])
    assert.throws(() =>
      accounts.loginWithIdentity(
        { email: "x@example.com", name: "x", subject: "x" },
        { defaultRole: role },
      ),
    );
});

test("sign-ins and account changes are written to the audit log", () => {
  const { accounts } = setup();
  accounts.createUser(SYSTEM, { email: "log@example.com", role: "viewer", password: PW });
  try {
    accounts.login({ email: "log@example.com", password: "nope", ip: "203.0.113.5" });
  } catch {}
  accounts.login({ email: "log@example.com", password: PW, ip: "203.0.113.5" });
  const events = accounts.listEvents().map((e) => e.event);
  for (const expected of ["user_created", "login_failed", "login_success"])
    assert.ok(events.includes(expected), `missing ${expected}`);
  assert.ok(
    accounts.listEvents().every((e) => !JSON.stringify(e).includes(PW)),
    "no secrets in the log",
  );
});
