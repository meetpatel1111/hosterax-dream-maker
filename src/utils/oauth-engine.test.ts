import test from "node:test";
import assert from "node:assert/strict";
import {
  generatePkcePair,
  verifyPkce,
  validateRedirectUri,
  generateOAuthCredentials,
  createOAuthClient,
  introspectToken,
  buildAuthorizationUrl,
  OAUTH_PRESET_TEMPLATES,
  AVAILABLE_OAUTH_SCOPES,
  type OAuthClient,
} from "./oauth-engine";

test("PKCE generator creates RFC 7636 compliant verifier and challenge", () => {
  const pkce = generatePkcePair(64);

  assert.equal(typeof pkce.codeVerifier, "string");
  assert.equal(pkce.codeVerifier.length, 64);
  assert.equal(pkce.codeChallengeMethod, "S256");
  assert.ok(pkce.codeChallenge.length > 0);
  assert.ok(!pkce.codeChallenge.includes("+"));
  assert.ok(!pkce.codeChallenge.includes("/"));
  assert.ok(!pkce.codeChallenge.includes("="));

  // Should verify successfully with same verifier
  const isValid = verifyPkce(pkce.codeVerifier, pkce.codeChallenge, "S256");
  assert.equal(isValid, true);

  // Should fail with altered verifier
  const isInvalid = verifyPkce(pkce.codeVerifier + "bad", pkce.codeChallenge, "S256");
  assert.equal(isInvalid, false);

  // Fails on non-S256 method
  assert.equal(verifyPkce(pkce.codeVerifier, pkce.codeChallenge, "plain" as any), false);
});

test("validateRedirectUri enforces OAuth 2.1 loopback, https, and fragment rules", () => {
  // Valid HTTPS
  assert.equal(validateRedirectUri("https://app.hosterax.io/oauth/callback").valid, true);

  // Valid localhost / loopback HTTP
  assert.equal(validateRedirectUri("http://localhost:3000/callback").valid, true);
  assert.equal(validateRedirectUri("http://127.0.0.1:8080/callback").valid, true);

  // Valid custom native URI scheme (e.g., for desktop or IDE)
  assert.equal(validateRedirectUri("cursor://oauth/callback").valid, true);
  assert.equal(validateRedirectUri("claude://oauth/callback").valid, true);

  // Invalid HTTP non-loopback
  const insecure = validateRedirectUri("http://remote.hosterax.io/callback");
  assert.equal(insecure.valid, false);
  assert.match(insecure.error || "", /loopback/i);

  // Invalid with fragment (#)
  const fragment = validateRedirectUri("https://app.hosterax.io/callback#token=123");
  assert.equal(fragment.valid, false);
  assert.match(fragment.error || "", /fragment/i);

  // Invalid empty or garbage
  assert.equal(validateRedirectUri("").valid, false);
  assert.equal(validateRedirectUri("not a uri").valid, false);
});

test("generateOAuthCredentials differentiates public vs confidential clients", () => {
  const pub = generateOAuthCredentials("public");
  assert.ok(pub.clientId.startsWith("hx_client_"));
  assert.equal(pub.clientSecret, undefined);

  const conf = generateOAuthCredentials("confidential");
  assert.ok(conf.clientId.startsWith("hx_client_"));
  assert.ok(conf.clientSecret?.startsWith("hx_sec_"));
  assert.ok(conf.clientSecretHint?.includes("..."));
});

test("createOAuthClient builds fully populated client instance", () => {
  const result = createOAuthClient({
    name: "Cursor AI Agent",
    description: "Development assistant",
    clientType: "confidential",
    redirectUris: ["https://api.cursor.com/callback", "cursor://oauth/callback"],
    scopes: ["mcp:tools", "deploy:containers"],
  });

  assert.equal(result.client.name, "Cursor AI Agent");
  assert.equal(result.client.clientType, "confidential");
  assert.equal(result.client.status, "active");
  assert.equal(result.client.scopes.length, 2);
  assert.ok(result.plainSecret?.startsWith("hx_sec_"));
  assert.ok(result.client.allowedGrantTypes.includes("client_credentials"));
});

test("introspectToken produces RFC 7662 compliant token metadata", () => {
  const mockClient: OAuthClient = {
    id: "app_123",
    name: "Test Client",
    description: "Test",
    clientType: "public",
    clientId: "hx_client_abc123",
    redirectUris: ["http://localhost:3000/callback"],
    scopes: ["read:projects", "mcp:tools"],
    allowedGrantTypes: ["authorization_code"],
    createdAt: new Date().toISOString(),
    status: "active",
    lastUsedAt: null,
  };

  const activeRes = introspectToken("hx_at_mock_token_xyz987", mockClient);
  assert.equal(activeRes.active, true);
  assert.equal(activeRes.client_id, "hx_client_abc123");
  assert.equal(activeRes.token_type, "Bearer");
  assert.equal(activeRes.scope, "read:projects mcp:tools");
  assert.ok((activeRes.exp || 0) > Math.floor(Date.now() / 1000));

  // Inactive if malformed token
  assert.equal(introspectToken("invalid_token", mockClient).active, false);

  // Inactive if client revoked
  const revokedClient = { ...mockClient, status: "revoked" as const };
  assert.equal(introspectToken("hx_at_mock_token_xyz987", revokedClient).active, false);
});

test("buildAuthorizationUrl constructs standard OAuth 2.1 query string", () => {
  const authUrl = buildAuthorizationUrl({
    endpoint: "https://control-plane.hosterax.internal",
    clientId: "hx_client_xyz",
    redirectUri: "http://localhost:5173/callback",
    scope: "mcp:tools read:projects",
    state: "random_state_token",
    codeChallenge: "challenge_hash_123",
    codeChallengeMethod: "S256",
  });

  const parsed = new URL(authUrl);
  assert.equal(parsed.pathname, "/oauth/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "hx_client_xyz");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://localhost:5173/callback");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("code_challenge"), "challenge_hash_123");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("state"), "random_state_token");
});

test("presets and scopes are well defined", () => {
  assert.ok(OAUTH_PRESET_TEMPLATES.length >= 3);
  assert.ok(AVAILABLE_OAUTH_SCOPES.length >= 5);
  for (const preset of OAUTH_PRESET_TEMPLATES) {
    assert.ok(preset.name.length > 0);
    assert.ok(preset.redirectUris.length > 0);
    assert.ok(preset.scopes.length > 0);
  }
});
