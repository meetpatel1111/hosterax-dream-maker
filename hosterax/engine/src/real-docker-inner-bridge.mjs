#!/usr/bin/env node
// Runs inside the unshare -U -n network namespace alongside real dockerd.
// Bridges DNS, outbound HTTP/HTTPS/SNI, and host-to-container TCP ingress over Unix domain sockets.
import net from "node:net";
import dgram from "node:dgram";
import fs from "node:fs";
import { execSync } from "node:child_process";

const BASE = process.env.HX_DOCKER_STATE || "/tmp/udocker";
const INGRESS_SOCK = `${BASE}/ingress.sock`;
const EGRESS_SOCK = `${BASE}/egress.sock`;
const DNS_SOCK = `${BASE}/dns.sock`;
const PROXY_PORT = 18123;
const HTTP_REDIR_PORT = 18080;
const HTTPS_REDIR_PORT = 18443;

try {
  execSync("ip link set lo up", { stdio: "ignore" });
} catch {}

// 1. Ingress listener: outer host connects -> sends "<ip>:<port>\n" -> we connect inside netns
try {
  fs.unlinkSync(INGRESS_SOCK);
} catch {}

const ingressServer = net.createServer((client) => {
  let buf = Buffer.alloc(0);
  let connected = false;

  const onData = (chunk) => {
    if (connected) return;
    buf = Buffer.concat([buf, chunk]);
    const nl = buf.indexOf(0x0a);
    if (nl === -1) {
      if (buf.length > 512) client.destroy();
      return;
    }
    connected = true;
    client.removeListener("data", onData);
    const header = buf.slice(0, nl).toString("utf8").trim();
    const rest = buf.slice(nl + 1);
    const lastColon = header.lastIndexOf(":");
    const targetHost = lastColon > 0 ? header.slice(0, lastColon) : "127.0.0.1";
    const targetPort = Number(lastColon > 0 ? header.slice(lastColon + 1) : header);
    if (!Number.isFinite(targetPort) || targetPort < 1 || targetPort > 65535) {
      client.destroy();
      return;
    }
    const upstream = net.connect({ host: targetHost, port: targetPort });
    upstream.on("connect", () => {
      if (rest.length > 0) upstream.write(rest);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  };

  client.on("data", onData);
  client.on("error", () => {});
});
ingressServer.listen(INGRESS_SOCK, () => {
  try {
    fs.chmodSync(INGRESS_SOCK, 0o666);
  } catch {}
});

// 2. HTTP/CONNECT proxy on 127.0.0.1:18123 (and later 172.17.0.1:18123) -> EGRESS_SOCK
function startProxyListener(host, port) {
  const srv = net.createServer((client) => {
    const upstream = net.connect(EGRESS_SOCK);
    upstream.on("connect", () => {
      client.pipe(upstream);
      upstream.pipe(client);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  srv.on("error", (err) => {
    console.error(`[inner-bridge] proxy listen ${host}:${port} failed:`, err.message);
  });
  srv.listen(port, host);
  return srv;
}

startProxyListener("127.0.0.1", PROXY_PORT);

// Helper: extract TLS SNI hostname from ClientHello packet
function extractTlsSni(buf) {
  try {
    if (buf.length < 43 || buf[0] !== 0x16 || buf[5] !== 0x01) return null;
    let pos = 43; // skip record(5) + handshake(4) + version(2) + random(32)
    if (pos >= buf.length) return null;
    const sessionIdLen = buf[pos];
    pos += 1 + sessionIdLen;
    if (pos + 2 > buf.length) return null;
    const cipherLen = buf.readUInt16BE(pos);
    pos += 2 + cipherLen;
    if (pos + 1 > buf.length) return null;
    const compLen = buf[pos];
    pos += 1 + compLen;
    if (pos + 2 > buf.length) return null;
    const extEnd = Math.min(buf.length, pos + 2 + buf.readUInt16BE(pos));
    pos += 2;
    while (pos + 4 <= extEnd) {
      const extType = buf.readUInt16BE(pos);
      const extLen = buf.readUInt16BE(pos + 2);
      pos += 4;
      if (extType === 0 && pos + extLen <= extEnd && extLen >= 5) {
        const listLen = buf.readUInt16BE(pos);
        let p = pos + 2;
        const end = Math.min(pos + 2 + listLen, extEnd);
        while (p + 3 <= end) {
          const nameType = buf[p];
          const nameLen = buf.readUInt16BE(p + 1);
          p += 3;
          if (nameType === 0 && p + nameLen <= end) {
            return buf.slice(p, p + nameLen).toString("utf8");
          }
          p += nameLen;
        }
      }
      pos += extLen;
    }
  } catch {}
  return null;
}

function connectViaEgress(host, port, initialChunk, client) {
  const upstream = net.connect(EGRESS_SOCK);
  let established = false;
  let respBuf = Buffer.alloc(0);

  upstream.on("connect", () => {
    upstream.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
  });

  const onResp = (chunk) => {
    if (established) return;
    respBuf = Buffer.concat([respBuf, chunk]);
    const idx = respBuf.indexOf("\r\n\r\n");
    if (idx === -1) return;
    const statusLine = respBuf.slice(0, idx).toString("utf8").split("\r\n")[0] || "";
    if (!/ 200 /.test(statusLine)) {
      client.destroy();
      upstream.destroy();
      return;
    }
    established = true;
    upstream.removeListener("data", onResp);
    const trailing = respBuf.slice(idx + 4);
    if (trailing.length > 0) client.write(trailing);
    if (initialChunk && initialChunk.length > 0) upstream.write(initialChunk);
    client.pipe(upstream);
    upstream.pipe(client);
  };

  upstream.on("data", onResp);
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
}

function startTransparentHttp(bindIp) {
  const srv = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let routed = false;
    const onData = (chunk) => {
      if (routed) return;
      buf = Buffer.concat([buf, chunk]);
      const hdrEnd = buf.indexOf("\r\n\r\n");
      if (hdrEnd === -1 && buf.length < 4096) return;
      routed = true;
      client.removeListener("data", onData);
      const hdrText = buf.slice(0, hdrEnd > 0 ? hdrEnd : buf.length).toString("utf8");
      const m = hdrText.match(/^Host:\s*([^\r\n]+)/im);
      if (!m) return client.destroy();
      const rawHost = m[1].trim();
      const idx = rawHost.lastIndexOf(":");
      const host = idx > 0 ? rawHost.slice(0, idx) : rawHost;
      const port = idx > 0 ? Number(rawHost.slice(idx + 1)) || 80 : 80;
      connectViaEgress(host, port, buf, client);
    };
    client.on("data", onData);
    client.on("error", () => {});
  });
  srv.on("error", () => {});
  srv.listen(HTTP_REDIR_PORT, bindIp);
}

function startTransparentHttps(bindIp) {
  const srv = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let routed = false;
    const onData = (chunk) => {
      if (routed) return;
      buf = Buffer.concat([buf, chunk]);
      const sni = extractTlsSni(buf);
      if (!sni && buf.length < 1500) return;
      routed = true;
      client.removeListener("data", onData);
      if (!sni) return client.destroy();
      connectViaEgress(sni, 443, buf, client);
    };
    client.on("data", onData);
    client.on("error", () => {});
  });
  srv.on("error", () => {});
  srv.listen(HTTPS_REDIR_PORT, bindIp);
}

function startDnsServer(bindIp) {
  const udp = dgram.createSocket("udp4");
  udp.on("message", (msg, rinfo) => {
    const sock = net.connect(DNS_SOCK);
    const frame = Buffer.alloc(2 + msg.length);
    frame.writeUInt16BE(msg.length, 0);
    msg.copy(frame, 2);
    let resp = Buffer.alloc(0);
    sock.on("connect", () => sock.write(frame));
    sock.on("data", (d) => {
      resp = Buffer.concat([resp, d]);
      if (resp.length >= 2) {
        const len = resp.readUInt16BE(0);
        if (resp.length >= 2 + len) {
          udp.send(resp.slice(2, 2 + len), rinfo.port, rinfo.address, () => {});
          sock.destroy();
        }
      }
    });
    sock.on("error", () => {});
  });
  udp.on("error", () => {});
  udp.bind(53, bindIp);
}

const HOST_FWD_SOCK = `${BASE}/hostfwd.sock`;
const BRIDGE_STATE_FILE = `${BASE}/bridge-state.json`;
const gatewayListeners = new Map(); // `gw:${port}` -> { server, target }
const outerListeners = new Map(); // `outer:${bindIp}:${port}` -> server
let bridgeReady = false;

function syncInnerBridgeState() {
  if (!bridgeReady) return;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(BRIDGE_STATE_FILE, "utf8"));
  } catch {
    return;
  }

  // 1. Bind 172.17.0.1:<PublicPort> -> <containerIp>:<PrivatePort> so containers using host.docker.internal:<port> hit Docker containers
  const wantGw = new Map();
  for (const item of state.bridgeGatewayTargets || []) {
    if (item?.publicPort && item?.target) wantGw.set(item.publicPort, item.target);
  }
  for (const [port, entry] of gatewayListeners.entries()) {
    if (wantGw.get(port) !== entry.target) {
      try {
        entry.server.close();
      } catch {}
      gatewayListeners.delete(port);
    }
  }
  for (const [port, target] of wantGw.entries()) {
    if (gatewayListeners.has(port)) continue;
    const idx = target.lastIndexOf(":");
    const tHost = idx > 0 ? target.slice(0, idx) : "127.0.0.1";
    const tPort = Number(idx > 0 ? target.slice(idx + 1) : target);
    const srv = net.createServer((client) => {
      const up = net.connect({ host: tHost, port: tPort });
      up.on("connect", () => {
        client.pipe(up);
        up.pipe(client);
      });
      up.on("error", () => client.destroy());
      client.on("error", () => up.destroy());
    });
    srv.on("error", () => gatewayListeners.delete(port));
    srv.listen(port, "172.17.0.1");
    gatewayListeners.set(port, { server: srv, target });
  }

  // 2. Bind 127.0.0.1:<outerPort> + 172.17.0.1:<outerPort> -> HOST_FWD_SOCK -> outer 127.0.0.1:<outerPort>
  const wantOuter = new Set(state.outerPorts || []);
  for (const [key, srv] of outerListeners.entries()) {
    const port = Number(key.split(":")[1]);
    if (!wantOuter.has(port) || wantGw.has(port)) {
      try {
        srv.close();
      } catch {}
      outerListeners.delete(key);
    }
  }
  for (const port of wantOuter) {
    if (wantGw.has(port)) continue;
    for (const bindIp of ["127.0.0.1", "172.17.0.1"]) {
      const key = `${bindIp}:${port}`;
      if (outerListeners.has(key)) continue;
      const srv = net.createServer((client) => {
        const up = net.connect(HOST_FWD_SOCK);
        up.on("connect", () => {
          up.write(`${port}\n`);
          client.pipe(up);
          up.pipe(client);
        });
        up.on("error", () => client.destroy());
        client.on("error", () => up.destroy());
      });
      srv.on("error", () => outerListeners.delete(key));
      srv.listen(port, bindIp);
      outerListeners.set(key, srv);
    }
  }
}

// Wait for docker0 (172.17.0.1) to come up once dockerd starts, then bind bridge services
let bridgeStarted = false;
const timer = setInterval(() => {
  if (bridgeStarted) return;
  try {
    const out = execSync("ip -4 addr show docker0 2>/dev/null || true", { encoding: "utf8" });
    if (out.includes("172.17.0.1")) {
      bridgeStarted = true;
      bridgeReady = true;
      clearInterval(timer);
      startProxyListener("172.17.0.1", PROXY_PORT);
      startDnsServer("172.17.0.1");
      startTransparentHttp("172.17.0.1");
      startTransparentHttps("172.17.0.1");
      try {
        execSync(
          `iptables -t nat -C PREROUTING -i docker0 -p tcp --dport 80 -j REDIRECT --to-ports ${HTTP_REDIR_PORT} 2>/dev/null || iptables -t nat -A PREROUTING -i docker0 -p tcp --dport 80 -j REDIRECT --to-ports ${HTTP_REDIR_PORT}`,
          { stdio: "ignore" },
        );
        execSync(
          `iptables -t nat -C PREROUTING -i docker0 -p tcp --dport 443 -j REDIRECT --to-ports ${HTTPS_REDIR_PORT} 2>/dev/null || iptables -t nat -A PREROUTING -i docker0 -p tcp --dport 443 -j REDIRECT --to-ports ${HTTPS_REDIR_PORT}`,
          { stdio: "ignore" },
        );
      } catch (e) {
        console.error("[inner-bridge] iptables nat setup warn:", e.message);
      }
      setInterval(syncInnerBridgeState, 400);
      syncInnerBridgeState();
      console.log("[inner-bridge] Bridge proxy, DNS (172.17.0.1:53), HTTP/SNI NAT, and host.docker.internal ready.");
    }
  } catch {}
}, 300);

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
