import fs from "node:fs";
import path from "node:path";

export function parseComposeContent(yamlText, filePath = "docker-compose.yml") {
  const lines = String(yamlText || "").split(/\r?\n/);
  const services = [];
  let inServices = false,
    serviceIndent = null,
    cur = null,
    key = null,
    keyIndent = null;
  const indentOf = (l) => l.match(/^\s*/)[0].length;
  const unquote = (s) => s.replace(/^["']|["']$/g, "");
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const ind = indentOf(raw);
    const line = raw.trim();
    if (ind === 0) {
      inServices = /^services:/.test(line);
      serviceIndent = null;
      cur = null;
      key = null;
      keyIndent = null;
      continue;
    }
    if (!inServices) continue;
    if (serviceIndent === null && line.endsWith(":")) {
      serviceIndent = ind;
    }
    if (serviceIndent !== null && ind <= serviceIndent && line.endsWith(":")) {
      cur = {
        name: line.slice(0, -1).trim(),
        image: null,
        build_context: null,
        ports: [],
        volumes: [],
        env: {},
        depends: [],
      };
      services.push(cur);
      key = null;
      keyIndent = null;
      continue;
    }
    if (!cur) continue;
    const item = line.match(/^-\s*(.+)$/);
    if (item) {
      const val = unquote(item[1].trim());
      if (key === "ports") cur.ports.push(val);
      else if (key === "volumes") cur.volumes.push(val);
      else if (key === "depends_on") cur.depends.push(val);
      else if (key === "environment") {
        const eqIdx = val.indexOf("=");
        if (eqIdx > 0) {
          cur.env[val.slice(0, eqIdx).trim()] = val.slice(eqIdx + 1).trim();
        }
      }
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (kv) {
      const kName = kv[1];
      const val = unquote(kv[2].trim());
      if (keyIndent !== null && ind > keyIndent) {
        if (key === "environment") {
          cur.env[kName] = val;
        } else if (key === "build" && kName === "context" && val) {
          cur.build_context = val;
        } else if (key === "depends_on" && ind === keyIndent + (serviceIndent || 2)) {
          if (!cur.depends.includes(kName)) cur.depends.push(kName);
        }
        continue;
      }
      key = kName;
      keyIndent = ind;
      if (key === "image" && val) cur.image = val;
      else if (key === "build" && val) cur.build_context = val;
      else if (key === "context" && val) cur.build_context = val;
    }
  }
  return { file: filePath, services };
}

export function parseCompose(workdir) {
  const file = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"]
    .map((f) => path.join(workdir, f))
    .find(fs.existsSync);
  if (!file) return null;
  return parseComposeContent(fs.readFileSync(file, "utf8"), file);
}
