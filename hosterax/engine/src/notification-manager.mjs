// hosterax/engine/src/notification-manager.mjs
// Tells people when something needs them: a deploy failed, an app keeps crashing, a server went away, a
// backup (or its restore drill) failed, a public address could not be created.
//
// Channels are webhooks (JSON, optionally signed), Slack, Discord, ntfy, or email through the SMTP relay
// already configured for Mail. Everything is best effort and never throws into the code that raised the
// event; the outcome of each send is recorded so a broken channel is visible.

import crypto from "node:crypto";
import { encryptJson, decryptJson } from "./secrets.mjs";

/** What can be subscribed to, and what it means. */
export const EVENT_KINDS = {
  "deploy.failed": "A deployment failed",
  "deploy.succeeded": "A deployment finished successfully",
  "project.unhealthy": "An app crashed, kept failing, or was rolled back",
  "server.down": "A server became unreachable or needs attention",
  "server.up": "A server is reachable again",
  "backup.failed": "A scheduled backup or its restore drill failed",
  "tunnel.failed": "A public address could not be created",
  "system.docker": "Docker stopped responding on this machine",
};
// Chatty by nature: off unless asked for.
const OFF_BY_DEFAULT = new Set(["deploy.succeeded", "server.up"]);

export const CHANNEL_TYPES = ["webhook", "slack", "discord", "ntfy", "email"];

const SELF_HEAL_EVENTS = {
  crashloop_detected: "project.unhealthy",
  circuit_tripped_open: "project.unhealthy",
  oom_killed: "project.unhealthy",
  auto_rollback_trigger: "project.unhealthy",
  auto_rollback_complete: "project.unhealthy",
  auto_rollback_failed: "project.unhealthy",
  restart_failed: "project.unhealthy",
  daemon_unresponsive: "system.docker",
  backup_failed: "backup.failed",
  tunnel_failed: "tunnel.failed",
};

const DEDUPE_MS = 10 * 60 * 1000;
const SEND_TIMEOUT_MS = 8000;
const LOG_KEEP = 200;

/** http(s) only, and never the cloud metadata / link-local range. Same rule as Mail's alias webhooks. */
export function assertNotifyUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error("The URL is not valid");
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("The URL must be http or https");
  if (/^(169\.254\.|fe80:|\[fe80:|metadata\.google\.internal$)/i.test(u.hostname))
    throw new Error("The URL points at a link-local or metadata address");
  return u.toString();
}

const mask = (url) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…${u.pathname.slice(-4)}`;
  } catch {
    return "";
  }
};

export class NotificationManager {
  /**
   * @param {{ db: any, sendEmail?: (m: {to: string[], subject: string, text: string}) => Promise<void>,
   *   fetchImpl?: typeof fetch, now?: () => number, baseUrl?: () => string }} opts
   */
  constructor({ db, sendEmail, fetchImpl = fetch, now = () => Date.now(), baseUrl }) {
    this.db = db;
    this.sendEmail = sendEmail;
    this.fetch = fetchImpl;
    this.now = now;
    this.baseUrl = baseUrl || (() => "");
    this.recent = new Map();
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notification_channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_status TEXT,
        last_error TEXT,
        last_sent_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notification_log (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  }

  // ── channels ─────────────────────────────────────────────────────────────────────────────────

  _view(r) {
    const cfg = decryptJson(r.config);
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      events: JSON.parse(r.events || "[]"),
      enabled: r.enabled === 1,
      target: r.type === "email" ? (cfg.to || []).join(", ") : cfg.url ? mask(cfg.url) : "",
      signed: Boolean(cfg.secret),
      lastStatus: r.last_status,
      lastError: r.last_error,
      lastSentAt: r.last_sent_at,
      createdAt: r.created_at,
    };
  }

  list() {
    return this.db
      .prepare("SELECT * FROM notification_channels ORDER BY created_at ASC")
      .all()
      .map((r) => this._view(r));
  }

  get(id) {
    const r = this.db.prepare("SELECT * FROM notification_channels WHERE id=?").get(id);
    return r ? this._view(r) : null;
  }

  _validate(input, existing = null) {
    const type = input.type ?? existing?.type;
    if (!CHANNEL_TYPES.includes(type))
      throw new Error(`type must be one of: ${CHANNEL_TYPES.join(", ")}`);
    const name = String(input.name ?? existing?.name ?? "")
      .trim()
      .slice(0, 80);
    if (!name) throw new Error("name is required");
    const events = input.events ?? (existing ? JSON.parse(existing.events) : []);
    if (!Array.isArray(events) || events.some((e) => !EVENT_KINDS[e]))
      throw new Error(`events must be a list of: ${Object.keys(EVENT_KINDS).join(", ")}`);

    const prev = existing ? decryptJson(existing.config) : {};
    const cfg = {};
    if (type === "email") {
      const to = input.to ?? prev.to;
      const list = (Array.isArray(to) ? to : String(to || "").split(/[,\s]+/)).filter(Boolean);
      if (!list.length || list.length > 10) throw new Error("to needs 1 to 10 email addresses");
      for (const a of list)
        if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(a))
          throw new Error(`"${a}" is not a valid email address`);
      cfg.to = list;
    } else {
      const url = input.url && !String(input.url).includes("…") ? input.url : prev.url;
      if (!url) throw new Error("url is required");
      cfg.url = assertNotifyUrl(url);
      if (type === "webhook") {
        const secret = input.secret ?? prev.secret;
        if (secret) cfg.secret = String(secret);
      }
    }
    return { type, name, events, cfg };
  }

  create(input) {
    const { type, name, events, cfg } = this._validate(input);
    const id = `nch_${crypto.randomBytes(6).toString("hex")}`;
    this.db
      .prepare(
        "INSERT INTO notification_channels (id, name, type, config, events, enabled, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(id, name, type, encryptJson(cfg), JSON.stringify(events), 1, this.now());
    return this.get(id);
  }

  update(id, input) {
    const existing = this.db.prepare("SELECT * FROM notification_channels WHERE id=?").get(id);
    if (!existing) throw new Error("Notification channel not found");
    const { name, events, cfg } = this._validate(input, existing);
    const enabled = input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0;
    this.db
      .prepare("UPDATE notification_channels SET name=?, config=?, events=?, enabled=? WHERE id=?")
      .run(name, encryptJson(cfg), JSON.stringify(events), enabled, id);
    return this.get(id);
  }

  remove(id) {
    this.db.prepare("DELETE FROM notification_log WHERE channel_id=?").run(id);
    return this.db.prepare("DELETE FROM notification_channels WHERE id=?").run(id).changes > 0;
  }

  recentLog(limit = 50) {
    return this.db
      .prepare(
        `SELECT l.id, l.channel_id AS channelId, c.name AS channelName, l.kind, l.title, l.status, l.error, l.created_at AS createdAt
         FROM notification_log l LEFT JOIN notification_channels c ON c.id = l.channel_id
         ORDER BY l.created_at DESC LIMIT ?`,
      )
      .all(limit);
  }

  // ── events in ────────────────────────────────────────────────────────────────────────────────

  /** Turn an event from the engine's event log (self-heal, tunnels, servers, backups) into a notification. */
  fromEvent(e) {
    let kind = SELF_HEAL_EVENTS[e.eventType];
    if (e.eventType === "server_status") {
      kind = e.status === "error" ? "server.down" : e.status === "info" ? "server.up" : null;
    }
    if (!kind) return Promise.resolve();
    const severity = e.status === "info" || e.status === "success" ? "info" : "error";
    return this.notify(kind, {
      title: `${EVENT_KINDS[kind]}${e.project && e.project !== "system" ? `: ${e.project}` : ""}`,
      text: e.details,
      project: e.project && e.project !== "system" ? e.project : null,
      severity,
    });
  }

  /**
   * Send to every enabled channel that subscribed to `kind`. Resolves when the sends are done; never rejects.
   * A repeat of the same event for the same project within ten minutes is dropped (flapping apps do not
   * become a flood), except for outcomes that are single events by nature.
   */
  async notify(kind, { title, text = "", project = null, severity = "error", fields = {} } = {}) {
    try {
      if (!EVENT_KINDS[kind]) return;
      if (!["deploy.succeeded", "deploy.failed", "server.up"].includes(kind)) {
        const key = `${kind}:${project || ""}`;
        const last = this.recent.get(key);
        if (last && this.now() - last < DEDUPE_MS) return;
        this.recent.set(key, this.now());
        if (this.recent.size > 500) this.recent.delete(this.recent.keys().next().value);
      }
      const rows = this.db
        .prepare("SELECT * FROM notification_channels WHERE enabled=1")
        .all()
        .filter((r) => {
          const events = JSON.parse(r.events || "[]");
          return events.length ? events.includes(kind) : !OFF_BY_DEFAULT.has(kind);
        });
      const message = {
        kind,
        title: title || EVENT_KINDS[kind],
        text: String(text || "").slice(0, 1500),
        project,
        severity,
        fields,
        timestamp: this.now(),
      };
      await Promise.all(rows.map((r) => this._deliver(r, message)));
    } catch {
      // never let a notification problem reach the code that raised the event
    }
  }

  /** Send a test message to one channel and report what happened. */
  async test(id) {
    const r = this.db.prepare("SELECT * FROM notification_channels WHERE id=?").get(id);
    if (!r) throw new Error("Notification channel not found");
    return this._deliver(r, {
      kind: "test",
      title: "HosteraX test notification",
      text: "If you can read this, this channel works.",
      project: null,
      severity: "info",
      fields: {},
      timestamp: this.now(),
    });
  }

  // ── delivery ─────────────────────────────────────────────────────────────────────────────────

  async _deliver(row, m) {
    let ok = false;
    let error = null;
    try {
      const cfg = decryptJson(row.config);
      await this._send(row.type, cfg, m);
      ok = true;
    } catch (err) {
      error = String(err.message || err).slice(0, 300);
    }
    const now = this.now();
    this.db
      .prepare(
        "UPDATE notification_channels SET last_status=?, last_error=?, last_sent_at=? WHERE id=?",
      )
      .run(ok ? "ok" : "failed", error, now, row.id);
    this.db
      .prepare(
        "INSERT INTO notification_log (id, channel_id, kind, title, status, error, created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        `nl_${crypto.randomBytes(5).toString("hex")}`,
        row.id,
        m.kind,
        m.title,
        ok ? "sent" : "failed",
        error,
        now,
      );
    this.db
      .prepare(
        "DELETE FROM notification_log WHERE id NOT IN (SELECT id FROM notification_log ORDER BY created_at DESC LIMIT ?)",
      )
      .run(LOG_KEEP);
    return { ok, error };
  }

  async _post(url, { headers = {}, body, attempts = 2 }) {
    let last;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.fetch(url, {
          method: "POST",
          headers,
          body,
          redirect: "manual",
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (res.status >= 200 && res.status < 300) return;
        last = new Error(
          res.status >= 300 && res.status < 400
            ? `The URL redirects (${res.status}); use the final address`
            : `The service answered ${res.status}`,
        );
        if (res.status < 500) break; // a client error will not fix itself
      } catch (err) {
        last = new Error(
          err.name === "TimeoutError" ? "The service did not answer in time" : err.message,
        );
      }
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 1500));
    }
    throw last;
  }

  async _send(type, cfg, m) {
    const line = `${m.title}${m.text ? `\n${m.text}` : ""}`;
    if (type === "slack") {
      return this._post(cfg.url, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `${m.severity === "error" ? ":rotating_light: " : ""}*${m.title}*${m.text ? `\n${m.text}` : ""}`,
        }),
      });
    }
    if (type === "discord") {
      return this._post(cfg.url, {
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content:
            `${m.severity === "error" ? "🚨 " : ""}**${m.title}**${m.text ? `\n${m.text}` : ""}`.slice(
              0,
              1900,
            ),
        }),
      });
    }
    if (type === "ntfy") {
      return this._post(cfg.url, {
        headers: {
          Title: m.title.replace(/[^\x20-\x7e]/g, "").slice(0, 200) || "HosteraX",
          Priority: m.severity === "error" ? "high" : "default",
          Tags: m.severity === "error" ? "rotating_light" : "white_check_mark",
        },
        body: m.text || m.title,
      });
    }
    if (type === "email") {
      if (!this.sendEmail)
        throw new Error("Email is not available: add an SMTP relay under Mail first");
      return this.sendEmail({
        to: cfg.to,
        subject: `[HosteraX] ${m.title}`.slice(0, 200),
        text: `${line}\n\n— HosteraX${this.baseUrl() ? ` (${this.baseUrl()})` : ""}`,
      });
    }
    // generic webhook: JSON, signed when a secret is set so the receiver can tell it came from here
    const body = JSON.stringify({ source: "hosterax", ...m });
    const headers = { "content-type": "application/json", "user-agent": "HosteraX-Notifier" };
    if (cfg.secret)
      headers["x-hosterax-signature"] =
        `sha256=${crypto.createHmac("sha256", cfg.secret).update(body).digest("hex")}`;
    return this._post(cfg.url, { headers, body });
  }
}
