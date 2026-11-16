import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseCompose } from "../src/compose-parser.mjs";

test("parseCompose handles mapping environment vars, build context objects, and condition depends_on", () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hx-compose-work-"));
  fs.writeFileSync(
    path.join(workdir, "docker-compose.yml"),
    `services:
  api:
    build:
      context: ./server
    ports:
      - "4000:4000"
    environment:
      DATABASE_URL: "postgres://postgres:pw@db:5432/app"
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_PASSWORD=pw
    volumes:
      - pgdata:/var/lib/postgresql/data
`,
    "utf8",
  );

  const parsed = parseCompose(workdir);
  assert.ok(parsed);
  assert.equal(parsed.services.length, 2);

  const api = parsed.services.find((s) => s.name === "api");
  assert.ok(api);
  assert.equal(api.build_context, "./server");
  assert.deepEqual(api.ports, ["4000:4000"]);
  assert.equal(api.env.DATABASE_URL, "postgres://postgres:pw@db:5432/app");
  assert.equal(api.env.NODE_ENV, "production");
  assert.deepEqual(api.depends, ["db"]);

  const db = parsed.services.find((s) => s.name === "db");
  assert.ok(db);
  assert.equal(db.env.POSTGRES_PASSWORD, "pw");
});
