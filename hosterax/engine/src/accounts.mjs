// hosterax/engine/src/accounts.mjs
// User accounts, sessions, roles and two-factor authentication.
//
// Accounts are additive: API tokens and trusted-local access keep working exactly as before. A user
// signs in (password + optional TOTP, or SSO) and receives a session token `hxs_…`, which is sent as
// `Authorization: Bearer` like any API token and resolved into the same scope levels the rest of the
// engine already enforces:
//
//   owner → ["*"]   admin → ["admin"]   developer → ["deploy"]   viewer → ["read"]
//
// Roles are looked up on every request, so changing a role, disabling a user or deleting one takes
// effect immediately and revokes their sessions.

import crypto from "node:crypto";
import { hashPassword, verifyPassword, hashToken } from "./security.mjs";
import { encryptSecret, decryptSecret } from "./secrets.mjs";
import { generateSecret, verifyTotp, otpauthUri } from "./totp.mjs";

export const ROLES = ["owner", "admin", "developer", "viewer"];
const ROLE_SCOPES = {
  owner: ["*"],
  admin: ["admin"],
  developer: ["deploy"],
  viewer: ["read"],
};
/** Which roles an actor may grant, change or remove. "system" = an admin API token or the local machine. */
const MANAGES = {
  owner: ROLES,
  system: ROLES,
  admin: ["developer", "viewer"],
};

const HOUR = 3600000;
const DAY = 24 * HOUR;
const SESSION_IDLE_MS = 7 * DAY;
const SESSION_ABSOLUTE_MS = 30 * DAY;
const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60000;
const RECOVERY_CODES = 8;

// Run a hash even for unknown emails so response time does not reveal which accounts exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

export class AccountError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const normEmail = (e) =>
  String(e || "")
    .trim()
    .toLowerCase();

function assertEmail(email) {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AccountError("a valid email address is required");
}

export function assertPassword(password) {
  const pw = String(password ?? "");
  if (pw.length < 10) throw new AccountError("the password must be at least 10 characters");
  if (pw.length > 200) throw new AccountError("the password is too long (200 characters at most)");
  if (!pw.trim()) throw new AccountError("the password cannot be blank");
}

export function scopesForRole(role) {
  return ROLE_SCOPES[role] ? [...ROLE_SCOPES[role]] : [];
}

export class AccountManager {
  constructor({ db, now = () => Date.now(), issuer = "HosteraX" }) {
    this.db = db;
    this.now = now;
    this.issuer = issuer;
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL DEFAULT '',
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'viewer',
        disabled INTEGER NOT NULL DEFAULT 0,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_last_step INTEGER NOT NULL DEFAULT 0,
        recovery_codes_json TEXT NOT NULL DEFAULT '[]',
        auth_source TEXT NOT NULL DEFAULT 'password',
        oidc_subject TEXT,
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT,
        method TEXT NOT NULL DEFAULT 'password'
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS login_attempts (
        email TEXT PRIMARY KEY,
        failures INTEGER NOT NULL DEFAULT 0,
        locked_until INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS auth_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        user_id TEXT,
        email TEXT,
        event TEXT NOT NULL,
        ip TEXT,
        detail TEXT
      );
    `);
  }

  // ───────────── helpers ─────────────

  record(event, { userId = null, email = null, ip = null, detail = null } = {}) {
    try {
      this.db
        .prepare(
          "INSERT INTO auth_events (ts, user_id, email, event, ip, detail) VALUES (?,?,?,?,?,?)",
        )
        .run(this.now(), userId, email, event, ip, detail);
      // keep the log bounded
      this.db
        .prepare("DELETE FROM auth_events WHERE id <= (SELECT MAX(id) FROM auth_events) - 5000")
        .run();
    } catch {}
  }

  listEvents(limit = 100) {
    return this.db
      .prepare("SELECT * FROM auth_events ORDER BY id DESC LIMIT ?")
      .all(Math.min(Math.max(Number(limit) || 100, 1), 500));
  }

  hasUsers() {
    return this.db.prepare("SELECT COUNT(*) c FROM users").get().c > 0;
  }

  _row(id) {
    return this.db.prepare("SELECT * FROM users WHERE id=?").get(id);
  }

  _rowByEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE email=?").get(normEmail(email));
  }

  publicUser(r) {
    if (!r) return null;
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      disabled: r.disabled === 1,
      twoFactorEnabled: r.totp_enabled === 1,
      authSource: r.auth_source,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
    };
  }

  listUsers() {
    return this.db
      .prepare("SELECT * FROM users ORDER BY created_at ASC")
      .all()
      .map((r) => this.publicUser(r));
  }

  getUser(id) {
    return this.publicUser(this._row(id));
  }

  _actorRole(actor) {
    return actor?.kind === "user" ? actor.user.role : actor?.kind === "system" ? "system" : null;
  }

  _canManage(actor, targetRole) {
    const allowed = MANAGES[this._actorRole(actor)];
    return Boolean(allowed && allowed.includes(targetRole));
  }

  _activeOwners(exceptId = null) {
    return this.db
      .prepare("SELECT COUNT(*) c FROM users WHERE role='owner' AND disabled=0 AND id<>?")
      .get(exceptId ?? "").c;
  }

  // ───────────── user management ─────────────

  createUser(actor, { email, name = "", role = "viewer", password }, { source = "password" } = {}) {
    const mail = normEmail(email);
    assertEmail(mail);
    if (!ROLES.includes(role)) throw new AccountError(`role must be one of: ${ROLES.join(", ")}`);
    if (!this._canManage(actor, role))
      throw new AccountError(`you are not allowed to create a ${role}`, 403);
    if (source === "password") assertPassword(password);
    if (this._rowByEmail(mail))
      throw new AccountError("a user with this email already exists", 409);
    const id = `usr_${crypto.randomBytes(6).toString("hex")}`;
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, role, auth_source, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        mail,
        String(name).trim().slice(0, 100),
        source === "password" ? hashPassword(password) : null,
        role,
        source,
        this.now(),
      );
    this.record("user_created", { userId: id, email: mail, detail: `role ${role}` });
    return this.getUser(id);
  }

  /** The very first account becomes the owner. Only possible while no user exists. */
  bootstrapOwner({ email, name = "Owner", password }) {
    if (this.hasUsers()) throw new AccountError("the owner account has already been created", 409);
    return this.createUser({ kind: "system" }, { email, name, role: "owner", password });
  }

  updateUser(actor, id, patch) {
    const target = this._row(id);
    if (!target) throw new AccountError("user not found", 404);
    const self = actor?.kind === "user" && actor.user.id === id;
    const onlyName = Object.keys(patch).every((k) => k === "name");
    // anyone may rename themselves; everything else needs authority over the target's role
    if (!(self && onlyName) && !this._canManage(actor, target.role))
      throw new AccountError(`you are not allowed to change a ${target.role}`, 403);

    const sets = [];
    const values = [];
    const put = (col, v) => {
      sets.push(`${col}=?`);
      values.push(v);
    };
    if (patch.name !== undefined) put("name", String(patch.name).trim().slice(0, 100));
    let revoke = false;
    if (patch.role !== undefined) {
      if (!ROLES.includes(patch.role))
        throw new AccountError(`role must be one of: ${ROLES.join(", ")}`);
      if (!this._canManage(actor, patch.role))
        throw new AccountError(`you are not allowed to grant ${patch.role}`, 403);
      if (target.role === "owner" && patch.role !== "owner" && this._activeOwners(id) === 0)
        throw new AccountError("there must always be at least one active owner", 409);
      put("role", patch.role);
    }
    if (patch.disabled !== undefined) {
      const disable = Boolean(patch.disabled);
      if (disable && self) throw new AccountError("you cannot disable your own account", 409);
      if (disable && target.role === "owner" && this._activeOwners(id) === 0)
        throw new AccountError("there must always be at least one active owner", 409);
      put("disabled", disable ? 1 : 0);
      if (disable) revoke = true;
    }
    if (patch.password !== undefined) {
      if (target.auth_source !== "password")
        throw new AccountError("this account signs in with SSO");
      assertPassword(patch.password);
      put("password_hash", hashPassword(patch.password));
      revoke = true;
    }
    if (sets.length)
      this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id=?`).run(...values, id);
    // roles are looked up on every request, so only disabling or a new password needs sessions ended
    if (revoke) this.revokeUserSessions(id);
    this.record("user_updated", {
      userId: id,
      email: target.email,
      detail: Object.keys(patch)
        .filter((k) => k !== "password")
        .concat(patch.password !== undefined ? ["password"] : [])
        .join(","),
    });
    return this.getUser(id);
  }

  deleteUser(actor, id) {
    const target = this._row(id);
    if (!target) throw new AccountError("user not found", 404);
    if (actor?.kind === "user" && actor.user.id === id)
      throw new AccountError("you cannot delete your own account", 409);
    if (!this._canManage(actor, target.role))
      throw new AccountError(`you are not allowed to delete a ${target.role}`, 403);
    if (target.role === "owner" && this._activeOwners(id) === 0)
      throw new AccountError("there must always be at least one active owner", 409);
    this.revokeUserSessions(id);
    this.db.prepare("DELETE FROM users WHERE id=?").run(id);
    this.record("user_deleted", { userId: id, email: target.email });
    return true;
  }

  // ───────────── sessions ─────────────

  createSession(userRow, { ip = null, userAgent = null, method = "password" } = {}) {
    const token = "hxs_" + crypto.randomBytes(24).toString("hex");
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, last_used_at, expires_at, absolute_expires_at, ip, user_agent, method)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `ses_${crypto.randomBytes(6).toString("hex")}`,
        userRow.id,
        hashToken(token),
        now,
        now,
        now + SESSION_IDLE_MS,
        now + SESSION_ABSOLUTE_MS,
        ip,
        String(userAgent || "").slice(0, 200),
        method,
      );
    this.db.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(now, userRow.id);
    return { token, expiresAt: now + SESSION_IDLE_MS };
  }

  /** Signs a user in without a password check — for flows that already authenticated them (first-run setup). */
  sessionForUser(userId, meta = {}) {
    const row = this._row(userId);
    if (!row) throw new AccountError("user not found", 404);
    return this.createSession(row, meta);
  }

  /** Resolves a session token to `{ user, scopes, sessionId }`, or null if it is unknown, expired or disabled. */
  resolveSession(token) {
    if (!String(token || "").startsWith("hxs_")) return null;
    const s = this.db.prepare("SELECT * FROM sessions WHERE token_hash=?").get(hashToken(token));
    if (!s) return null;
    const now = this.now();
    if (now > s.expires_at || now > s.absolute_expires_at) {
      this.db.prepare("DELETE FROM sessions WHERE id=?").run(s.id);
      return null;
    }
    const user = this._row(s.user_id);
    if (!user || user.disabled === 1) return null;
    // sliding idle window, never beyond the absolute limit; written at most every 5 minutes
    if (now - s.last_used_at > 5 * 60000) {
      this.db
        .prepare("UPDATE sessions SET last_used_at=?, expires_at=? WHERE id=?")
        .run(now, Math.min(now + SESSION_IDLE_MS, s.absolute_expires_at), s.id);
    }
    return { user: this.publicUser(user), scopes: scopesForRole(user.role), sessionId: s.id };
  }

  revokeSession(token) {
    return (
      this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashToken(token)).changes > 0
    );
  }

  revokeUserSessions(userId, exceptSessionId = null) {
    return this.db
      .prepare("DELETE FROM sessions WHERE user_id=? AND id<>?")
      .run(userId, exceptSessionId ?? "").changes;
  }

  listSessions(userId) {
    return this.db
      .prepare(
        "SELECT id, created_at, last_used_at, expires_at, ip, user_agent, method FROM sessions WHERE user_id=? ORDER BY last_used_at DESC",
      )
      .all(userId);
  }

  purgeExpiredSessions() {
    const now = this.now();
    return this.db
      .prepare("DELETE FROM sessions WHERE expires_at<? OR absolute_expires_at<?")
      .run(now, now).changes;
  }

  // ───────────── sign in ─────────────

  _lockState(email) {
    const r = this.db.prepare("SELECT * FROM login_attempts WHERE email=?").get(email);
    if (r && r.locked_until > this.now()) return r;
    return null;
  }

  _fail(email, ip) {
    const now = this.now();
    const r = this.db.prepare("SELECT * FROM login_attempts WHERE email=?").get(email);
    // the counter is reset to 0 whenever a lock is set, so an expired lock starts a fresh count
    const failures = (r?.failures ?? 0) + 1;
    const lockedUntil = failures >= MAX_FAILURES ? now + LOCK_MS : 0;
    this.db
      .prepare(
        `INSERT INTO login_attempts (email, failures, locked_until) VALUES (?,?,?)
         ON CONFLICT(email) DO UPDATE SET failures=excluded.failures, locked_until=excluded.locked_until`,
      )
      .run(email, lockedUntil ? 0 : failures, lockedUntil);
    this.record(lockedUntil ? "login_locked" : "login_failed", { email, ip });
  }

  _clearFailures(email) {
    this.db.prepare("DELETE FROM login_attempts WHERE email=?").run(email);
  }

  /**
   * Password sign-in. Throws AccountError: 401 for bad credentials (same message whether or not the
   * email exists), 401 with `twoFactorRequired` when the password was right but a code is needed,
   * 429 while the email is locked after repeated failures.
   */
  login({ email, password, code, ip = null, userAgent = null }) {
    const mail = normEmail(email);
    const lock = this._lockState(mail);
    if (lock) {
      const seconds = Math.ceil((lock.locked_until - this.now()) / 1000);
      throw new AccountError(
        `too many failed attempts — try again in ${Math.ceil(seconds / 60)} minute(s)`,
        429,
        { retryAfterSeconds: seconds },
      );
    }
    const user = this._rowByEmail(mail);
    const passwordOk = verifyPassword(String(password ?? ""), user?.password_hash || DUMMY_HASH);
    if (!user || !user.password_hash || !passwordOk || user.disabled === 1) {
      this._fail(mail, ip);
      throw new AccountError("invalid email or password", 401);
    }
    if (user.totp_enabled === 1) {
      if (!code)
        throw new AccountError("a two-factor code is required", 401, { twoFactorRequired: true });
      if (!this._acceptSecondFactor(user, code)) {
        this._fail(mail, ip);
        throw new AccountError("invalid email, password or two-factor code", 401, {
          twoFactorRequired: true,
        });
      }
    }
    this._clearFailures(mail);
    const session = this.createSession(user, { ip, userAgent, method: "password" });
    this.record("login_success", { userId: user.id, email: mail, ip });
    return { ...session, user: this.getUser(user.id) };
  }

  /** TOTP (never the same step twice) or a single-use recovery code. */
  _acceptSecondFactor(user, code) {
    if (user.totp_secret) {
      const step = verifyTotp(decryptSecret(user.totp_secret), code, {
        now: this.now(),
        lastStep: user.totp_last_step,
      });
      if (step !== null) {
        this.db.prepare("UPDATE users SET totp_last_step=? WHERE id=?").run(step, user.id);
        return true;
      }
    }
    const normalized = String(code).trim().toLowerCase();
    const hashes = JSON.parse(user.recovery_codes_json || "[]");
    const h = hashToken(normalized);
    const idx = hashes.indexOf(h);
    if (idx === -1) return false;
    hashes.splice(idx, 1);
    this.db
      .prepare("UPDATE users SET recovery_codes_json=? WHERE id=?")
      .run(JSON.stringify(hashes), user.id);
    this.record("recovery_code_used", { userId: user.id, email: user.email });
    return true;
  }

  /** Called after an identity provider has authenticated someone (see oidc.mjs). */
  loginWithIdentity(
    { email, name, subject },
    { defaultRole = "viewer", ip = null, userAgent = null },
  ) {
    const mail = normEmail(email);
    assertEmail(mail);
    if (!ROLES.includes(defaultRole) || defaultRole === "owner" || defaultRole === "admin")
      throw new AccountError("SSO may only provision developer or viewer accounts", 500);
    let user =
      this.db.prepare("SELECT * FROM users WHERE oidc_subject=?").get(subject) ||
      this._rowByEmail(mail);
    if (user && user.oidc_subject && user.oidc_subject !== subject)
      throw new AccountError("this email is already linked to a different SSO identity", 403);
    if (!user) {
      const created = this.createUser(
        { kind: "system" },
        { email: mail, name, role: defaultRole },
        { source: "oidc" },
      );
      user = this._row(created.id);
    }
    if (user.disabled === 1) {
      this.record("login_failed", {
        userId: user.id,
        email: mail,
        ip,
        detail: "sso, account disabled",
      });
      throw new AccountError("this account is disabled", 403);
    }
    if (!user.oidc_subject)
      this.db.prepare("UPDATE users SET oidc_subject=? WHERE id=?").run(subject, user.id);
    const session = this.createSession(user, { ip, userAgent, method: "oidc" });
    this.record("login_success", { userId: user.id, email: mail, ip, detail: "sso" });
    return { ...session, user: this.getUser(user.id) };
  }

  // ───────────── password and two-factor self-service ─────────────

  changePassword(userId, current, next, { keepSessionId = null } = {}) {
    const user = this._row(userId);
    if (!user) throw new AccountError("user not found", 404);
    if (!user.password_hash) throw new AccountError("this account signs in with SSO");
    if (!verifyPassword(String(current ?? ""), user.password_hash))
      throw new AccountError("the current password is wrong", 403);
    assertPassword(next);
    this.db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(next), userId);
    const revoked = this.revokeUserSessions(userId, keepSessionId);
    this.record("password_changed", {
      userId,
      email: user.email,
      detail: `${revoked} other session(s) ended`,
    });
    return { revokedSessions: revoked };
  }

  beginTwoFactor(userId) {
    const user = this._row(userId);
    if (!user) throw new AccountError("user not found", 404);
    if (user.totp_enabled === 1)
      throw new AccountError("two-factor authentication is already on", 409);
    const secret = generateSecret();
    this.db.prepare("UPDATE users SET totp_secret=? WHERE id=?").run(encryptSecret(secret), userId);
    return { secret, otpauthUri: otpauthUri({ secret, account: user.email, issuer: this.issuer }) };
  }

  enableTwoFactor(userId, code) {
    const user = this._row(userId);
    if (!user) throw new AccountError("user not found", 404);
    if (user.totp_enabled === 1)
      throw new AccountError("two-factor authentication is already on", 409);
    if (!user.totp_secret) throw new AccountError("start the setup first", 409);
    const step = verifyTotp(decryptSecret(user.totp_secret), code, { now: this.now() });
    if (step === null)
      throw new AccountError("that code is not valid — check your device's clock", 400);
    const codes = Array.from({ length: RECOVERY_CODES }, () => {
      const hex = crypto.randomBytes(5).toString("hex");
      return `${hex.slice(0, 5)}-${hex.slice(5)}`;
    });
    this.db
      .prepare(
        "UPDATE users SET totp_enabled=1, totp_last_step=?, recovery_codes_json=? WHERE id=?",
      )
      .run(step, JSON.stringify(codes.map((c) => hashToken(c))), userId);
    this.record("two_factor_enabled", { userId, email: user.email });
    return { recoveryCodes: codes };
  }

  disableTwoFactor(userId, { password, code }) {
    const user = this._row(userId);
    if (!user) throw new AccountError("user not found", 404);
    if (user.totp_enabled !== 1) throw new AccountError("two-factor authentication is not on", 409);
    if (user.password_hash && !verifyPassword(String(password ?? ""), user.password_hash))
      throw new AccountError("the password is wrong", 403);
    if (!this._acceptSecondFactor(user, code))
      throw new AccountError("that two-factor code is not valid", 403);
    this._clearTwoFactor(userId);
    this.record("two_factor_disabled", { userId, email: user.email });
  }

  /** Admin recovery: remove a user's second factor (e.g. lost phone and recovery codes). */
  resetTwoFactor(actor, id) {
    const target = this._row(id);
    if (!target) throw new AccountError("user not found", 404);
    if (!this._canManage(actor, target.role))
      throw new AccountError(`you are not allowed to change a ${target.role}`, 403);
    this._clearTwoFactor(id);
    this.revokeUserSessions(id);
    this.record("two_factor_reset", { userId: id, email: target.email });
  }

  _clearTwoFactor(userId) {
    this.db
      .prepare(
        "UPDATE users SET totp_secret=NULL, totp_enabled=0, totp_last_step=0, recovery_codes_json='[]' WHERE id=?",
      )
      .run(userId);
  }
}
