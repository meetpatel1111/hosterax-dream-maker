import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { OidcClient, OidcError, loadOidcConfig } from "../src/oidc.mjs";

// ───────────────────────── configuration ─────────────────────────

const goodEnv = {
  HOSTERAX_OIDC_ISSUER: "https://idp.example.com",
  HOSTERAX_OIDC_CLIENT_ID: "hosterax",
  HOSTERAX_OIDC_CLIENT_SECRET: "s3cret",
  HOSTERAX_PUBLIC_URL: "https://deploy.example.com/",
  HOSTERAX_OIDC_ALLOWED_DOMAINS: "Example.com, @corp.example",
};

test("SSO is off unless configured, and refuses unsafe or incomplete configuration", () => {
  assert.equal(loadOidcConfig({}), null);
  const reason = (env) => loadOidcConfig({ ...goodEnv, ...env }).reason;
  assert.match(reason({ HOSTERAX_OIDC_CLIENT_SECRET: "" }), /together/);
  assert.match(reason({ HOSTERAX_OIDC_ISSUER: "http://idp.example.com" }), /https/);
  assert.match(reason({ HOSTERAX_OIDC_ISSUER: "not a url" }), /valid URL/);
  assert.match(reason({ HOSTERAX_PUBLIC_URL: "" }), /HOSTERAX_PUBLIC_URL/);
  assert.match(reason({ HOSTERAX_OIDC_ALLOWED_DOMAINS: "" }), /ALLOWED_DOMAINS/);
  assert.match(reason({ HOSTERAX_OIDC_DEFAULT_ROLE: "admin" }), /developer or viewer/);

  const ok = loadOidcConfig(goodEnv);
  assert.equal(ok.ok, true);
  assert.equal(ok.redirectUri, "https://deploy.example.com/api/auth/oidc/callback");
  assert.deepEqual(ok.allowedDomains, ["example.com", "corp.example"]);
  assert.equal(ok.defaultRole, "viewer");
  // plain http is fine for a provider on this machine, and "any email" must be asked for explicitly
  assert.equal(
    loadOidcConfig({ ...goodEnv, HOSTERAX_OIDC_ISSUER: "http://127.0.0.1:9000" }).ok,
    true,
  );
  assert.equal(
    loadOidcConfig({
      ...goodEnv,
      HOSTERAX_OIDC_ALLOWED_DOMAINS: "",
      HOSTERAX_OIDC_ALLOW_ANY_EMAIL: "1",
    }).ok,
    true,
  );
});

// ───────────────────────── a mock identity provider ─────────────────────────

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaOther = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwkOf = (pair, kid, alg) => ({
  ...pair.publicKey.export({ format: "jwk" }),
  kid,
  use: "sig",
  alg,
});

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function sign({ header, claims, key = rsa.privateKey, alg = "RS256" }) {
  const data = `${b64({ typ: "JWT", ...header })}.${b64(claims)}`;
  if (alg === "none") return `${data}.`;
  if (alg === "HS256") {
    const hmac = crypto
      .createHmac("sha256", rsa.publicKey.export({ type: "spki", format: "pem" }))
      .update(data)
      .digest();
    return `${data}.${hmac.toString("base64url")}`;
  }
  const sig = crypto.sign(
    "sha256",
    Buffer.from(data),
    alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key,
  );
  return `${data}.${sig.toString("base64url")}`;
}

let server;
let issuer;
const idp = {};
const seen = { tokenRequests: [] };

function resetIdp() {
  idp.keys = [jwkOf(rsa, "k1", "RS256"), jwkOf(ec, "ec1", "ES256")];
  idp.tokenStatus = 200;
  idp.authMethods = ["client_secret_post", "client_secret_basic"];
  idp.expectChallenge = null;
  idp.idToken = null;
  seen.tokenRequests = [];
}

before(async () => {
  server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/.well-known/openid-configuration")
      return send(200, {
        issuer: idp.issuerClaim ?? issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        token_endpoint_auth_methods_supported: idp.authMethods,
      });
    if (req.url === "/jwks") return send(200, { keys: idp.keys });
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const form = new URLSearchParams(raw);
        seen.tokenRequests.push({ form, authorization: req.headers.authorization });
        const challenge = crypto
          .createHash("sha256")
          .update(form.get("code_verifier") || "")
          .digest("base64url");
        if (idp.tokenStatus !== 200) return send(idp.tokenStatus, { error: "invalid_grant" });
        if (idp.expectChallenge && challenge !== idp.expectChallenge)
          return send(400, { error: "pkce" });
        send(200, { id_token: idp.idToken, access_token: "x", token_type: "Bearer" });
      });
      return;
    }
    send(404, {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const config = () => ({
  ...loadOidcConfig({
    HOSTERAX_OIDC_ISSUER: issuer,
    HOSTERAX_OIDC_CLIENT_ID: "hosterax",
    HOSTERAX_OIDC_CLIENT_SECRET: "s3cret",
    HOSTERAX_PUBLIC_URL: "https://deploy.example.com",
    HOSTERAX_OIDC_ALLOWED_DOMAINS: "example.com",
  }),
});

const nowS = () => Math.floor(Date.now() / 1000);
const goodClaims = (nonce, extra = {}) => ({
  iss: issuer,
  aud: "hosterax",
  sub: "user-1",
  email: "Ada@Example.com",
  email_verified: true,
  name: "Ada Lovelace",
  iat: nowS(),
  exp: nowS() + 300,
  nonce,
  ...extra,
});

/** Runs a whole sign-in against the mock provider; `make` builds the ID token from the nonce. */
async function signIn(make, { client = new OidcClient({ config: config() }), code = "abc" } = {}) {
  resetIdpIfNeeded();
  const url = new URL(await client.begin());
  const nonce = url.searchParams.get("nonce");
  idp.expectChallenge = url.searchParams.get("code_challenge");
  idp.idToken = make(nonce);
  return { identity: await client.complete({ code, state: url.searchParams.get("state") }), url };
}
let primed = false;
function resetIdpIfNeeded() {
  if (!primed) {
    resetIdp();
    primed = true;
  }
}

const rejects = (make, pattern, status) =>
  assert.rejects(
    signIn(make),
    (e) => e instanceof OidcError && pattern.test(e.message) && (!status || e.status === status),
  );

// ───────────────────────── the flow ─────────────────────────

test("a valid sign-in returns the verified identity and uses PKCE, state and nonce", async () => {
  resetIdp();
  primed = true;
  const { identity, url } = await signIn((nonce) =>
    sign({ header: { alg: "RS256", kid: "k1" }, claims: goodClaims(nonce) }),
  );
  assert.deepEqual(identity, { email: "ada@example.com", name: "Ada Lovelace", subject: "user-1" });
  assert.equal(url.pathname, "/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://deploy.example.com/api/auth/oidc/callback",
  );
  assert.equal(url.searchParams.get("client_id"), "hosterax");
  assert.ok(url.searchParams.get("state") && url.searchParams.get("nonce"));
  const sent = seen.tokenRequests.at(-1).form;
  assert.equal(sent.get("grant_type"), "authorization_code");
  assert.equal(sent.get("client_secret"), "s3cret");
  assert.equal(sent.get("redirect_uri"), "https://deploy.example.com/api/auth/oidc/callback");
});

test("ES256 tokens are accepted, and key rotation is picked up", async () => {
  resetIdp();
  const es = await signIn((nonce) =>
    sign({
      header: { alg: "ES256", kid: "ec1" },
      claims: goodClaims(nonce),
      key: ec.privateKey,
      alg: "ES256",
    }),
  );
  assert.equal(es.identity.subject, "user-1");

  // the provider rotates to a key this client has never seen: it refetches the key set once
  const client = new OidcClient({ config: config() });
  await signIn(
    (nonce) => sign({ header: { alg: "RS256", kid: "k1" }, claims: goodClaims(nonce) }),
    { client },
  );
  idp.keys = [jwkOf(rsaOther, "k2", "RS256")];
  const rotated = await signIn(
    (nonce) =>
      sign({
        header: { alg: "RS256", kid: "k2" },
        claims: goodClaims(nonce),
        key: rsaOther.privateKey,
      }),
    { client },
  );
  assert.equal(rotated.identity.email, "ada@example.com");
});

test("forged, altered or misdirected ID tokens are rejected", async () => {
  resetIdp();
  const rs =
    (claimsFn, header = {}, key) =>
    (nonce) =>
      sign({ header: { alg: "RS256", kid: "k1", ...header }, claims: claimsFn(nonce), key });

  await rejects(
    rs((n) => goodClaims(n, { nonce: "someone-elses" })),
    /does not belong to this sign-in/,
  );
  await rejects(
    rs((n) => goodClaims(n, { exp: nowS() - 3600 })),
    /expired/,
  );
  await rejects(
    rs((n) => goodClaims(n, { aud: "another-app" })),
    /different application/,
  );
  await rejects(
    rs((n) => goodClaims(n, { aud: ["hosterax", "other"] })),
    /authorized party/,
  );
  await rejects(
    rs((n) => goodClaims(n, { iss: "https://evil.example" })),
    /wrong issuer/,
  );
  await rejects(
    rs((n) => goodClaims(n, { sub: undefined })),
    /no subject/,
  );
  await rejects(
    rs((n) => goodClaims(n), {}, rsaOther.privateKey),
    /signature is not valid/,
  );
  await rejects(
    rs((n) => goodClaims(n), { kid: "ghost" }),
    /unknown key/,
  );

  // algorithm confusion: "none", and an HMAC keyed with the public key
  await rejects(
    (n) => sign({ header: { alg: "none" }, claims: goodClaims(n), alg: "none" }),
    /unsupported algorithm/,
  );
  await rejects(
    (n) => sign({ header: { alg: "HS256", kid: "k1" }, claims: goodClaims(n), alg: "HS256" }),
    /unsupported algorithm/,
  );
  await rejects(() => "not.a.jwt.at.all", /malformed/);
  await rejects(() => "garbage", /malformed/);
});

test("only verified emails from allowed domains may sign in", async () => {
  resetIdp();
  const ok = (extra) => (nonce) =>
    sign({ header: { alg: "RS256", kid: "k1" }, claims: goodClaims(nonce, extra) });
  await rejects(ok({ email_verified: false }), /not verified/, 403);
  await rejects(ok({ email_verified: undefined }), /not verified/, 403);
  await rejects(ok({ email: undefined }), /email address/, 403);
  await rejects(ok({ email: "mallory@evil.example" }), /domain is not allowed/, 403);
  await rejects(ok({ email: "x@example.com.evil.example" }), /domain is not allowed/, 403);

  // a provider that does not send email_verified can be trusted explicitly
  const lenient = new OidcClient({ config: { ...config(), trustUnverifiedEmail: true } });
  const { identity } = await signIn(ok({ email_verified: undefined }), { client: lenient });
  assert.equal(identity.email, "ada@example.com");
});

test("a sign-in cannot be replayed, forged or resumed after it expires", async () => {
  resetIdp();
  const client = new OidcClient({ config: config() });
  const url = new URL(await client.begin());
  idp.idToken = sign({
    header: { alg: "RS256", kid: "k1" },
    claims: goodClaims(url.searchParams.get("nonce")),
  });
  const state = url.searchParams.get("state");
  assert.ok(await client.complete({ code: "abc", state }));
  await assert.rejects(client.complete({ code: "abc", state }), /expired or was not started here/);
  await assert.rejects(
    client.complete({ code: "abc", state: "made-up" }),
    /expired or was not started here/,
  );
  await assert.rejects(
    client.complete({ code: "abc", state: "" }),
    /expired or was not started here/,
  );

  let clock = Date.now();
  const slow = new OidcClient({ config: config(), now: () => clock });
  const u2 = new URL(await slow.begin());
  clock += 11 * 60000;
  await assert.rejects(
    slow.complete({ code: "abc", state: u2.searchParams.get("state") }),
    /expired/,
  );

  // missing code
  const u3 = new URL(await client.begin());
  await assert.rejects(
    client.complete({ state: u3.searchParams.get("state") }),
    /did not return a code/,
  );
});

test("provider failures surface as clean errors", async () => {
  resetIdp();
  idp.tokenStatus = 400;
  await assert.rejects(
    signIn((n) => sign({ header: { alg: "RS256", kid: "k1" }, claims: goodClaims(n) })),
    (e) => e.status === 401 && /refused/.test(e.message),
  );

  resetIdp();
  idp.issuerClaim = "https://someone-else.example";
  await assert.rejects(new OidcClient({ config: config() }).begin(), /issuer does not match/);
  delete idp.issuerClaim;

  const unreachable = new OidcClient({ config: { ...config(), issuer: "http://127.0.0.1:1" } });
  await assert.rejects(unreachable.begin(), (e) => e.status === 502);
});

test("client_secret_basic is used when the provider only supports it", async () => {
  resetIdp();
  idp.authMethods = ["client_secret_basic"];
  await signIn((n) => sign({ header: { alg: "RS256", kid: "k1" }, claims: goodClaims(n) }));
  const req = seen.tokenRequests.at(-1);
  assert.equal(req.authorization, `Basic ${Buffer.from("hosterax:s3cret").toString("base64")}`);
  assert.equal(req.form.get("client_secret"), null, "the secret must not also be sent in the body");
});
