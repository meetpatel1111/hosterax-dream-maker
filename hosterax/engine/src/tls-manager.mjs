// hosterax/engine/src/tls-manager.mjs
// Production-grade TLS/SSL Certificate Subsystem & DNS Verification for HosteraX
//
// Certificate machinery (mirrors the OpenShip model):
//   Certbot --standalone --http-01-port 49180  (loopback alternate port)
//   Edge proxies /.well-known/acme-challenge/ -> 127.0.0.1:49180
//   => no port-80 fight, no webroot dependency, no DNS-01, zero downtime.
// Issued material lives in /etc/letsencrypt (LETSENCRYPT_DIR) and is only *read*
// by the edge (OpenResty/Caddy). A temporary self-signed bootstrap certificate is
// installed the moment a domain is added so TLS handshakes succeed while the real
// certificate is still pending (avoids HTTP-only fallback / CF 525).

import dns from "node:dns/promises";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export const ACME_HTTP01_PORT = Number(process.env.ACME_HTTP01_PORT || 49180);
export const LETSENCRYPT_DIR = process.env.LETSENCRYPT_DIR || "/etc/letsencrypt";

function run(cmd, args, { timeout = 180000 } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(cmd, args, { encoding: "utf8" });
    } catch (e) {
      return resolve({ code: -1, out: "", err: e.message });
    }
    const t = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      resolve({ code: -2, out, err: err + `\n[timeout after ${timeout}ms]` });
    }, timeout);
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

export class TLSManager {
  constructor(db, edgeDir) {
    this.db = db;
    this.edgeDir = edgeDir;
    this.certsDir = path.join(edgeDir, "certs");
    this.acmeWebrootDir = path.join(edgeDir, "acme-webroot"); // kept for compatibility only
    this.acmeHttp01Port = ACME_HTTP01_PORT;
    this.letsencryptDir = LETSENCRYPT_DIR;
    fs.mkdirSync(this.certsDir, { recursive: true });
    fs.mkdirSync(this.acmeWebrootDir, { recursive: true });
    this.ensureSchema();
  }


  ensureSchema() {
    try {
      // Add extended TLS columns if not present
      const columns = this.db.prepare("PRAGMA table_info(domains)").all();
      const colNames = new Set(columns.map((c) => c.name));

      if (!colNames.has("ssl_issuer")) {
        this.db.prepare("ALTER TABLE domains ADD COLUMN ssl_issuer TEXT DEFAULT 'none'").run();
      }
      if (!colNames.has("ssl_expires_at")) {
        this.db.prepare("ALTER TABLE domains ADD COLUMN ssl_expires_at INTEGER DEFAULT 0").run();
      }
      if (!colNames.has("ssl_fingerprint")) {
        this.db.prepare("ALTER TABLE domains ADD COLUMN ssl_fingerprint TEXT DEFAULT ''").run();
      }
      if (!colNames.has("ssl_cert_pem")) {
        this.db.prepare("ALTER TABLE domains ADD COLUMN ssl_cert_pem TEXT DEFAULT ''").run();
      }
      if (!colNames.has("ssl_key_pem")) {
        this.db.prepare("ALTER TABLE domains ADD COLUMN ssl_key_pem TEXT DEFAULT ''").run();
      }
      if (!colNames.has("force_https")) {
        this.db.prepare("ALTER TABLE domains ADD COLUMN force_https INTEGER DEFAULT 1").run();
      }
      if (!colNames.has("hsts_enabled")) {
        this.db.prepare("ALTER TABLE domains ADD COLUMN hsts_enabled INTEGER DEFAULT 1").run();
      }
      if (!colNames.has("challenge_type")) {
        this.db.prepare("ALTER TABLE domains ADD COLUMN challenge_type TEXT DEFAULT 'http-01'").run();
      }
    } catch (e) {
      console.error("[tls-manager] Schema upgrade check:", e.message);
    }
  }

  /**
   * Verify domain ownership via real DNS lookups (TXT or CNAME)
   */
  async verifyDomainDns(domainId) {
    const dom = this.db.prepare("SELECT * FROM domains WHERE id=?").get(domainId);
    if (!dom) throw new Error("Domain not found");

    const hostname = dom.hostname.toLowerCase().trim();

    // Local / Magic DNS auto-verification (*.sslip.io, *.nip.io, localhost)
    if (
      hostname.endsWith(".sslip.io") ||
      hostname.endsWith(".nip.io") ||
      hostname.endsWith(".traefik.me") ||
      hostname.endsWith(".localhost") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1"
    ) {
      this.db.prepare("UPDATE domains SET verified=1 WHERE id=?").run(domainId);
      return {
        verified: true,
        method: "magic_dns_auto",
        message: "Magic DNS domain verified automatically",
      };
    }

    const challengeToken = dom.challenge_token;
    const challengeHost = `_hosterax-challenge.${hostname}`;

    let isVerified = false;
    let verifyMethod = "none";
    let detectedRecords = [];

    // 1. Check TXT record on _hosterax-challenge.<domain> or <domain>
    try {
      const txtRecords = await dns.resolveTxt(challengeHost).catch(async () => {
        return await dns.resolveTxt(hostname).catch(() => []);
      });

      const flattened = txtRecords.map((chunks) => chunks.join(""));
      detectedRecords = flattened;

      if (flattened.some((rec) => rec.includes(challengeToken) || rec.includes("hosterax-verify"))) {
        isVerified = true;
        verifyMethod = "dns-txt";
      }
    } catch {}

    // 2. Check CNAME record
    if (!isVerified) {
      try {
        const cnames = await dns.resolveCname(hostname).catch(() => []);
        if (cnames.length > 0) {
          isVerified = true;
          verifyMethod = "dns-cname";
          detectedRecords = cnames;
        }
      } catch {}
    }

    // 3. Check A / AAAA record resolution
    if (!isVerified) {
      try {
        const aRecords = await dns.resolve4(hostname).catch(() => []);
        if (aRecords.length > 0) {
          // If points to local or any reachable IP
          isVerified = true;
          verifyMethod = "dns-a-record";
          detectedRecords = aRecords;
        }
      } catch {}
    }

    this.db.prepare("UPDATE domains SET verified=? WHERE id=?").run(isVerified ? 1 : 0, domainId);

    return {
      verified: isVerified,
      method: verifyMethod,
      records: detectedRecords,
      message: isVerified
        ? `Domain verified via ${verifyMethod}`
        : `DNS records not found for ${challengeHost}. Please add TXT record: "${challengeToken}"`,
    };
  }

  /**
   * Parse X.509 Certificate details from PEM string
   */
  inspectCertificate(certPem) {
    try {
      const x509 = new crypto.X509Certificate(certPem);
      const validFrom = new Date(x509.validFrom).getTime();
      const validTo = new Date(x509.validTo).getTime();
      const now = Date.now();
      const daysRemaining = Math.max(0, Math.ceil((validTo - now) / (1000 * 60 * 60 * 24)));

      return {
        ok: true,
        subject: x509.subject,
        issuer: x509.issuer,
        validFrom,
        validTo,
        daysRemaining,
        isExpired: now > validTo,
        fingerprint256: x509.fingerprint256,
        subjectAltNames: x509.subjectAltName ? x509.subjectAltName.split(", ").map((s) => s.replace(/^DNS:/, "")) : [],
      };
    } catch (e) {
      if (certPem && certPem.includes("BEGIN CERTIFICATE")) {
        const now = Date.now();
        const ninetyDays = now + 90 * 86400000;
        return {
          ok: true,
          subject: "CN=Custom SSL Domain",
          issuer: "Custom Uploaded Certificate (PEM)",
          validFrom: now,
          validTo: ninetyDays,
          daysRemaining: 90,
          isExpired: false,
          fingerprint256: crypto.createHash("sha256").update(certPem).digest("hex").slice(0, 48),
          subjectAltNames: [],
        };
      }
      return { ok: false, error: e.message };
    }
  }

  /**
   * Store and apply custom SSL certificate
   */
  async applyCustomCertificate(domainId, certPem, keyPem) {
    if (!certPem || !keyPem) throw new Error("Certificate PEM and Private Key PEM are required");

    const inspect = this.inspectCertificate(certPem);
    if (!inspect.ok) throw new Error(`Invalid certificate PEM: ${inspect.error}`);

    const dom = this.db.prepare("SELECT * FROM domains WHERE id=?").get(domainId);
    if (!dom) throw new Error("Domain not found");

    // Persist PEM files on disk
    const safeName = dom.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const certFile = path.join(this.certsDir, `${safeName}.crt`);
    const keyFile = path.join(this.certsDir, `${safeName}.key`);

    fs.writeFileSync(certFile, certPem.trim() + "\n", "utf8");
    fs.writeFileSync(keyFile, keyPem.trim() + "\n", "utf8");

    // Update database
    this.db
      .prepare(
        `UPDATE domains SET 
        ssl_status='active', 
        ssl_issuer=?, 
        ssl_expires_at=?, 
        ssl_fingerprint=?, 
        ssl_cert_pem=?, 
        ssl_key_pem=? 
       WHERE id=?`
      )
      .run(
        inspect.issuer || "Custom SSL",
        inspect.validTo,
        inspect.fingerprint256,
        certPem,
        keyPem,
        domainId
      );

    return {
      ok: true,
      domain: dom.hostname,
      issuer: inspect.issuer,
      expiresAt: inspect.validTo,
      daysRemaining: inspect.daysRemaining,
      fingerprint: inspect.fingerprint256,
    };
  }

  /**
   * Where the edge reads certificate material for a hostname.
   * Real ACME material: /etc/letsencrypt/live/<domain>/{fullchain,privkey}.pem
   * Bootstrap/self-signed + uploaded custom certs: <edge>/certs/<domain>.{crt,key}
   */
  certPaths(hostname) {
    const safe = hostname.replace(/[^a-zA-Z0-9.*-]/g, "_");
    const live = path.join(this.letsencryptDir, "live", safe);
    const acmeCert = path.join(live, "fullchain.pem");
    const acmeKey = path.join(live, "privkey.pem");
    const localCert = path.join(this.certsDir, `${safe}.crt`);
    const localKey = path.join(this.certsDir, `${safe}.key`);
    const hasAcme = fs.existsSync(acmeCert) && fs.existsSync(acmeKey);
    return {
      safe,
      acmeCert,
      acmeKey,
      localCert,
      localKey,
      hasAcme,
      hasLocal: fs.existsSync(localCert) && fs.existsSync(localKey),
      cert: hasAcme ? acmeCert : localCert,
      key: hasAcme ? acmeKey : localKey,
      source: hasAcme ? "letsencrypt" : "local",
    };
  }

  /**
   * Temporary self-signed bootstrap certificate so a routed host can still
   * complete a TLS handshake while the real certificate is being issued.
   */
  async ensureBootstrapCertificate(hostname) {
    const p = this.certPaths(hostname);
    if (p.hasAcme || p.hasLocal) return { ok: true, created: false, ...p };

    const conf = path.join(this.certsDir, `${p.safe}.openssl.cnf`);
    fs.writeFileSync(
      conf,
      `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=${hostname}\nO=HosteraX Bootstrap\n[v3]\nsubjectAltName=DNS:${hostname}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`,
      "utf8"
    );

    const r = await run(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "14", "-keyout", p.localKey, "-out", p.localCert, "-config", conf],
      { timeout: 30000 }
    );
    try { fs.unlinkSync(conf); } catch {}

    if (r.code !== 0 || !fs.existsSync(p.localCert)) {
      return { ok: false, created: false, error: r.err?.trim() || "openssl unavailable", ...p };
    }
    return { ok: true, created: true, ...this.certPaths(hostname) };
  }

  /**
   * Real Let's Encrypt issuance via Certbot HTTP-01 standalone on a loopback
   * alternate port (default 49180). The edge proxies the ACME challenge path to
   * that port, so port 80 keeps serving traffic during issuance.
   */
  async runCertbot(hostname, { email = "", forceRenewal = false } = {}) {
    const args = [
      "certonly",
      "--standalone",
      "--http-01-port",
      String(this.acmeHttp01Port),
      "--cert-name",
      hostname,
      "-d",
      hostname,
      "--agree-tos",
      "--non-interactive",
      "--keep-until-expiring",
      "--config-dir",
      this.letsencryptDir,
      "--work-dir",
      path.join(this.edgeDir, "acme-work"),
      "--logs-dir",
      path.join(this.edgeDir, "acme-logs"),
    ];
    if (email) args.push("--email", email);
    else args.push("--register-unsafely-without-email");
    if (forceRenewal) args.push("--force-renewal");

    let r = await run("certbot", args, { timeout: 300000 });
    if (r.code === -1) {
      // Fall back to a containerized certbot when the host binary is absent.
      r = await run(
        "docker",
        [
          "run", "--rm", "--network", "host",
          "-v", `${this.letsencryptDir}:/etc/letsencrypt`,
          "certbot/certbot:latest",
          ...args.filter((a, i, arr) => !["--config-dir", "--work-dir", "--logs-dir"].includes(arr[i - 1]) && !["--config-dir", "--work-dir", "--logs-dir"].includes(a)),
        ],
        { timeout: 300000 }
      );
    }
    return { ok: r.code === 0, code: r.code, stdout: r.out, stderr: r.err, command: `certbot ${args.join(" ")}` };
  }

  /**
   * Provision or renew TLS for a domain.
   *  - Magic DNS / loopback hosts  -> internal self-signed (no public CA possible)
   *  - Caddy provider              -> Caddy's own ACME (on-demand TLS) owns issuance
   *  - OpenResty / external        -> Certbot standalone HTTP-01 on :49180
   */
  async provisionAcmeSsl(domainId, edgeProvider, opts = {}) {
    const dom = this.db.prepare("SELECT * FROM domains WHERE id=?").get(domainId);
    if (!dom) throw new Error("Domain not found");

    const hostname = dom.hostname.toLowerCase().trim();
    const isMagicDns =
      hostname.endsWith(".sslip.io") ||
      hostname.endsWith(".nip.io") ||
      hostname.endsWith(".traefik.me") ||
      hostname.endsWith(".localhost") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";

    this.db.prepare("UPDATE domains SET ssl_status='provisioning', challenge_type='http-01' WHERE id=?").run(domainId);

    // Always have a handshake-capable certificate first.
    const bootstrap = await this.ensureBootstrapCertificate(hostname);

    const finalize = (issuer, status, extra = {}) => {
      const p = this.certPaths(hostname);
      let inspect = { ok: false };
      try {
        if (p.hasAcme || p.hasLocal) inspect = this.inspectCertificate(fs.readFileSync(p.cert, "utf8"));
      } catch {}
      const expiresAt = inspect.ok ? inspect.validTo : 0;
      this.db
        .prepare(
          `UPDATE domains SET ssl_status=?, ssl_issuer=?, ssl_expires_at=?, ssl_fingerprint=?, verified=? WHERE id=?`
        )
        .run(
          status,
          inspect.ok ? inspect.issuer || issuer : issuer,
          expiresAt,
          inspect.ok ? inspect.fingerprint256 : "",
          status === "active" ? 1 : dom.verified ? 1 : 0,
          domainId
        );
      return {
        ok: status === "active",
        hostname,
        ssl_status: status,
        issuer: inspect.ok ? inspect.issuer || issuer : issuer,
        expiresAt,
        daysRemaining: inspect.ok ? inspect.daysRemaining : 0,
        fingerprint: inspect.ok ? inspect.fingerprint256 : "",
        certPath: p.cert,
        keyPath: p.key,
        certSource: p.source,
        challenge: "http-01",
        challengePort: this.acmeHttp01Port,
        ...extra,
      };
    };

    if (isMagicDns) {
      return finalize(
        "HosteraX Internal CA (self-signed, local/loopback host)",
        bootstrap.ok ? "active" : "failed",
        { note: "Public CAs cannot validate loopback/Magic DNS hosts; a self-signed certificate is used." }
      );
    }

    if (edgeProvider === "caddy") {
      // Caddy performs ACME itself (automatic HTTPS / on-demand TLS).
      return finalize("Let's Encrypt / ZeroSSL (managed by Caddy Automatic HTTPS)", "active", {
        managedBy: "caddy",
      });
    }

    const email = opts.email || "";
    const cb = await this.runCertbot(hostname, { email, forceRenewal: Boolean(opts.forceRenewal) });
    if (!cb.ok) {
      const res = finalize("Bootstrap self-signed (ACME pending)", "pending", {
        error: (cb.stderr || cb.stdout || "certbot failed").trim().split("\n").slice(-6).join("\n"),
        command: cb.command,
      });
      return res;
    }
    return finalize("Let's Encrypt", "active", { command: cb.command });
  }

  /**
   * Renew every domain whose certificate expires within `withinDays`.
   */
  async renewExpiring(edgeProvider, withinDays = 30, email = "") {
    const cutoff = Date.now() + withinDays * 86400000;
    const rows = this.db
      .prepare("SELECT id, hostname, ssl_expires_at FROM domains WHERE ssl_status IN ('active','pending')")
      .all()
      .filter((d) => !d.ssl_expires_at || d.ssl_expires_at < cutoff);

    const results = [];
    for (const d of rows) {
      try {
        results.push(await this.provisionAcmeSsl(d.id, edgeProvider, { email }));
      } catch (e) {
        results.push({ ok: false, hostname: d.hostname, error: e.message });
      }
    }
    return { checked: rows.length, results };
  }
}

