// hosterax/engine/src/oidc.mjs
// Single sign-on with any OpenID Connect provider (authorization code flow + PKCE).
//
// Configuration (environment):
//   HOSTERAX_OIDC_ISSUER           the provider's issuer URL, exactly as it appears in its discovery document
//   HOSTERAX_OIDC_CLIENT_ID / HOSTERAX_OIDC_CLIENT_SECRET
//   HOSTERAX_PUBLIC_URL            where users reach this engine; the redirect URI is <it>/api/auth/oidc/callback
//   HOSTERAX_OIDC_ALLOWED_DOMAINS  comma list of email domains allowed to sign in
//                                  (or HOSTERAX_OIDC_ALLOW_ANY_EMAIL=1 to accept any verified email)
//   HOSTERAX_OIDC_DEFAULT_ROLE     developer | viewer (default viewer); admins are never created by SSO
//   HOSTERAX_OIDC_NAME             label for the sign-in button (default "SSO")
//
// The ID token is verified in full: signature against the provider's JWKS (RS256 / ES256 only),
// issuer, audience, expiry, nonce, and a verified email address.

import crypto from "node:crypto";

export class OidcError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const STATE_TTL_MS = 10 * 60000;
const MAX_STATES = 500;
const CLOCK_SKEW_S = 60;

/** Returns null when SSO is not configured, `{ ok: false, reason }` when it is configured wrongly. */
export function loadOidcConfig(env = process.env) {
  const issuer = env.HOSTERAX_OIDC_ISSUER;
  const clientId = env.HOSTERAX_OIDC_CLIENT_ID;
  const clientSecret = env.HOSTERAX_OIDC_CLIENT_SECRET;
  if (!issuer && !clientId && !clientSecret) return null;
  const fail = (reason) => ({ ok: false, reason });
  if (!issuer || !clientId || !clientSecret)
    return fail(
      "set HOSTERAX_OIDC_ISSUER, HOSTERAX_OIDC_CLIENT_ID and HOSTERAX_OIDC_CLIENT_SECRET together",
    );
  let issuerUrl;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    return fail("HOSTERAX_OIDC_ISSUER is not a valid URL");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(issuerUrl.hostname);
  if (issuerUrl.protocol !== "https:" && !(local && issuerUrl.protocol === "http:"))
    return fail("HOSTERAX_OIDC_ISSUER must use https");
  const publicUrl = env.HOSTERAX_PUBLIC_URL;
  if (!publicUrl) return fail("set HOSTERAX_PUBLIC_URL so the provider can redirect back here");
  try {
    new URL(publicUrl);
  } catch {
    return fail("HOSTERAX_PUBLIC_URL is not a valid URL");
  }
  const allowedDomains = String(env.HOSTERAX_OIDC_ALLOWED_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  const allowAny = env.HOSTERAX_OIDC_ALLOW_ANY_EMAIL === "1";
  if (!allowedDomains.length && !allowAny)
    return fail(
      "set HOSTERAX_OIDC_ALLOWED_DOMAINS (e.g. example.com) — or HOSTERAX_OIDC_ALLOW_ANY_EMAIL=1 to accept any verified email",
    );
  const defaultRole = env.HOSTERAX_OIDC_DEFAULT_ROLE || "viewer";
  if (!["developer", "viewer"].includes(defaultRole))
    return fail("HOSTERAX_OIDC_DEFAULT_ROLE must be developer or viewer");
  return {
    ok: true,
    issuer,
    clientId,
    clientSecret,
    scopes: env.HOSTERAX_OIDC_SCOPES || "openid email profile",
    redirectUri: `${publicUrl.replace(/\/$/, "")}/api/auth/oidc/callback`,
    allowedDomains,
    defaultRole,
    name: env.HOSTERAX_OIDC_NAME || "SSO",
    trustUnverifiedEmail: env.HOSTERAX_OIDC_TRUST_UNVERIFIED_EMAIL === "1",
  };
}

export class OidcClient {
  constructor({ config, fetchImpl = fetch, now = () => Date.now() }) {
    this.config = config;
    this.fetch = fetchImpl;
    this.now = now;
    this.states = new Map(); // state -> { verifier, nonce, createdAt }
    this._discovery = null;
    this._jwks = null;
  }

  async _getJson(url, label) {
    let res;
    try {
      res = await this.fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch (e) {
      throw new OidcError(`could not reach the identity provider (${label}): ${e.message}`, 502);
    }
    if (!res.ok)
      throw new OidcError(`the identity provider answered ${res.status} (${label})`, 502);
    try {
      return await res.json();
    } catch {
      throw new OidcError(`the identity provider sent an unreadable ${label} response`, 502);
    }
  }

  async discovery() {
    if (this._discovery && this.now() - this._discovery.at < 3600000) return this._discovery.doc;
    const base = this.config.issuer.replace(/\/$/, "");
    const doc = await this._getJson(`${base}/.well-known/openid-configuration`, "discovery");
    if (doc.issuer !== this.config.issuer)
      throw new OidcError("the provider's issuer does not match HOSTERAX_OIDC_ISSUER", 502);
    for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"])
      if (!doc[k]) throw new OidcError(`the provider's discovery document has no ${k}`, 502);
    this._discovery = { doc, at: this.now() };
    return doc;
  }

  async _keys(forceRefresh = false) {
    if (!forceRefresh && this._jwks && this.now() - this._jwks.at < 3600000) return this._jwks.keys;
    const { jwks_uri } = await this.discovery();
    const body = await this._getJson(jwks_uri, "signing keys");
    this._jwks = { keys: Array.isArray(body.keys) ? body.keys : [], at: this.now() };
    return this._jwks.keys;
  }

  /** Starts a sign-in: returns the URL to send the browser to. */
  async begin() {
    const doc = await this.discovery();
    const now = this.now();
    for (const [s, v] of this.states) if (now - v.createdAt > STATE_TTL_MS) this.states.delete(s);
    if (this.states.size >= MAX_STATES) throw new OidcError("too many sign-ins in progress", 429);
    const state = b64url(crypto.randomBytes(24));
    const nonce = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(32));
    this.states.set(state, { verifier, nonce, createdAt: now });
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes,
      state,
      nonce,
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  /** Finishes a sign-in: exchanges the code and returns the verified identity `{ email, name, subject }`. */
  async complete({ code, state }) {
    const entry = this.states.get(String(state || ""));
    this.states.delete(String(state || "")); // one use only, whatever happens next
    if (!entry || this.now() - entry.createdAt > STATE_TTL_MS)
      throw new OidcError("the sign-in expired or was not started here — try again", 400);
    if (!code) throw new OidcError("the identity provider did not return a code", 400);

    const doc = await this.discovery();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: entry.verifier,
    });
    const headers = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    const methods = doc.token_endpoint_auth_methods_supported;
    if (
      Array.isArray(methods) &&
      !methods.includes("client_secret_post") &&
      methods.includes("client_secret_basic")
    ) {
      const cred = `${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`;
      headers.authorization = `Basic ${Buffer.from(cred).toString("base64")}`;
    } else {
      body.set("client_secret", this.config.clientSecret);
    }
    let res;
    try {
      res = await this.fetch(doc.token_endpoint, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
    } catch (e) {
      throw new OidcError(
        `could not reach the identity provider's token endpoint: ${e.message}`,
        502,
      );
    }
    if (!res.ok) throw new OidcError("the identity provider refused the sign-in code", 401);
    const tokens = await res.json().catch(() => ({}));
    if (!tokens.id_token) throw new OidcError("the identity provider returned no ID token", 502);

    const claims = await this._verifyIdToken(tokens.id_token, entry.nonce);
    const email = String(claims.email || "").toLowerCase();
    if (!email) throw new OidcError("the identity provider did not share an email address", 403);
    if (claims.email_verified !== true && !this.config.trustUnverifiedEmail)
      throw new OidcError("the email address is not verified by the identity provider", 403);
    const { allowedDomains } = this.config;
    if (allowedDomains.length && !allowedDomains.includes(email.split("@")[1]))
      throw new OidcError("this email domain is not allowed to sign in", 403);
    return {
      email,
      name: String(claims.name || claims.preferred_username || email.split("@")[0]).slice(0, 100),
      subject: String(claims.sub),
    };
  }

  async _verifyIdToken(token, expectedNonce) {
    const parts = String(token).split(".");
    if (parts.length !== 3) throw new OidcError("the ID token is malformed", 401);
    let header;
    let claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      throw new OidcError("the ID token is malformed", 401);
    }
    // only asymmetric algorithms from an explicit allow-list: never "none", never HMAC with a public key
    if (header.alg !== "RS256" && header.alg !== "ES256")
      throw new OidcError(`the ID token uses an unsupported algorithm (${header.alg})`, 401);

    const pick = (keys) => {
      const usable = keys.filter(
        (k) => (k.use ?? "sig") === "sig" && (!k.alg || k.alg === header.alg),
      );
      return header.kid
        ? usable.find((k) => k.kid === header.kid)
        : usable.length === 1
          ? usable[0]
          : null;
    };
    let jwk = pick(await this._keys());
    if (!jwk) jwk = pick(await this._keys(true)); // the provider may have rotated its keys
    if (!jwk) throw new OidcError("the ID token was signed with an unknown key", 401);

    let valid = false;
    try {
      const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
      const data = Buffer.from(`${parts[0]}.${parts[1]}`);
      const sig = Buffer.from(parts[2], "base64url");
      valid = crypto.verify(
        "sha256",
        data,
        header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key,
        sig,
      );
    } catch {
      valid = false;
    }
    if (!valid) throw new OidcError("the ID token's signature is not valid", 401);

    const nowS = Math.floor(this.now() / 1000);
    if (claims.iss !== this.config.issuer)
      throw new OidcError("the ID token has the wrong issuer", 401);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(this.config.clientId))
      throw new OidcError("the ID token was issued for a different application", 401);
    if (aud.length > 1 && claims.azp !== this.config.clientId)
      throw new OidcError("the ID token's authorized party is wrong", 401);
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < nowS)
      throw new OidcError("the ID token has expired", 401);
    if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > nowS)
      throw new OidcError("the ID token is not valid yet", 401);
    if (!claims.nonce || claims.nonce !== expectedNonce)
      throw new OidcError("the ID token does not belong to this sign-in", 401);
    if (!claims.sub) throw new OidcError("the ID token has no subject", 401);
    return claims;
  }
}
