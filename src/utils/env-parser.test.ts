import test from "node:test";
import assert from "node:assert/strict";
import { parseDotEnvText, formatDotEnvText, isLikelySecretEnvKey } from "./env-parser";

test("parseDotEnvText handles exports, quotes, comments, and URLs with equals signs", () => {
  const raw = `
# Database config
export DATABASE_URL="postgres://user:p@ss=word@db:5432/app?sslmode=disable"
APP_NAME=HosteraX App # inline comment
SINGLE_QUOTED='hello # not a comment'
MULTILINE="line1\\nline2"
DATABASE_URL="postgres://override@db:5432/app"
`;

  const { entries, errors } = parseDotEnvText(raw);
  assert.equal(errors.length, 0);
  assert.equal(entries.length, 4);

  const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
  assert.equal(byKey.DATABASE_URL.value, "postgres://override@db:5432/app");
  assert.equal(byKey.DATABASE_URL.inferredSecret, true);
  assert.equal(byKey.APP_NAME.value, "HosteraX App");
  assert.equal(byKey.APP_NAME.inferredSecret, false);
  assert.equal(byKey.SINGLE_QUOTED.value, "hello # not a comment");
  assert.equal(byKey.MULTILINE.value, "line1\nline2");
});

test("parseDotEnvText reports malformed lines without discarding valid entries", () => {
  const { entries, errors } = parseDotEnvText(`
BAD_LINE_NO_EQUALS
1INVALID_KEY=value
VALID_KEY=ok
`);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "VALID_KEY");
  assert.equal(errors.length, 2);
});

test("formatDotEnvText safely quotes values and masks stored secrets", () => {
  const formatted = formatDotEnvText([
    { key: "NODE_ENV", value: "production", isSecret: false },
    { key: "SITE_TITLE", value: "My Cool App", isSecret: false },
    { key: "JWT_SECRET", value: "••••••••", isSecret: true },
  ]);
  assert.match(formatted, /^NODE_ENV=production/m);
  assert.match(formatted, /^SITE_TITLE="My Cool App"/m);
  assert.match(formatted, /^# JWT_SECRET=<stored-secret-overwrite-to-update>/m);
  assert.equal(isLikelySecretEnvKey("STRIPE_SECRET_KEY"), true);
});
