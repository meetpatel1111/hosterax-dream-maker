// hosterax/engine/src/metrics-manager.mjs
// Real-Time Container Metrics, Alerting Watchdog, and Log Analytics Subsystem for HosteraX
// Tracks live CPU/RAM/Net/Disk I/O, historical ring buffers, log level parsing, and threshold alerts.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export class MetricsManager {
  constructor({ db, HOME, LOGDIR }) {
    this.db = db;
    this.HOME = HOME;
    this.LOGDIR = LOGDIR || path.join(HOME, "logs");
    
    // In-memory ring buffers: projectName -> Array of 60 metrics snapshots
    this.metricsHistory = new Map();
    // In-memory active alerts: projectName -> [alerts]
    this.activeAlerts = new Map();

    this.initSchema();
    this.startMetricsCollector();
  }

  initSchema() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS alert_rules (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          metric_type TEXT NOT NULL, -- 'cpu', 'memory', 'crash', 'errors'
          threshold REAL NOT NULL,
          duration_seconds INTEGER DEFAULT 60,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alert_history (
          id TEXT PRIMARY KEY,
          project TEXT NOT NULL,
          metric_type TEXT NOT NULL,
          value REAL NOT NULL,
          threshold REAL NOT NULL,
          message TEXT NOT NULL,
          status TEXT NOT NULL, -- 'triggered', 'resolved'
          created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_alert_rules_proj ON alert_rules(project);
        CREATE INDEX IF NOT EXISTS idx_alert_hist_proj ON alert_history(project);
      `);
    } catch (e) {
      console.warn("[metrics-manager] Schema init warning:", e.message);
    }
  }

  /**
   * Collect real-time metrics across all active Docker containers
   */
  collectDockerMetrics() {
    const now = Date.now();
    try {
      const res = spawnSync(
        "docker",
        ["stats", "--no-stream", "--format", '{"id":"{{.ID}}","name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem":"{{.MemUsage}}","memPerc":"{{.MemPerc}}","net":"{{.NetIO}}","block":"{{.BlockIO}}"}'],
        { encoding: "utf8", timeout: 4000 }
      );

      if (res.status !== 0 || !res.stdout) {
        return;
      }

      const lines = res.stdout.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          const rawName = raw.name || "";
          const projectName = rawName.startsWith("hx_") ? rawName.slice(3).toLowerCase() : rawName.toLowerCase();

          const cpu = parseFloat(raw.cpu.replace("%", "")) || 0;
          const memPerc = parseFloat(raw.memPerc.replace("%", "")) || 0;

          // Parse memory usage (e.g. "45.2MiB / 1.95GiB")
          let usedMb = 0;
          let limitMb = 0;
          if (raw.mem && raw.mem.includes("/")) {
            const parts = raw.mem.split("/");
            usedMb = this.parseSizeToMb(parts[0]?.trim());
            limitMb = this.parseSizeToMb(parts[1]?.trim());
          }

          const snapshot = {
            timestamp: now,
            projectName,
            containerId: raw.id,
            cpuPercent: Math.round(cpu * 10) / 10,
            memoryUsedMb: Math.round(usedMb * 10) / 10,
            memoryLimitMb: Math.round(limitMb * 10) / 10,
            memoryPercent: Math.round(memPerc * 10) / 10,
            networkIo: raw.net || "0B / 0B",
            blockIo: raw.block || "0B / 0B",
          };

          // Store in circular buffer (max 60 samples)
          if (!this.metricsHistory.has(projectName)) {
            this.metricsHistory.set(projectName, []);
          }
          const buf = this.metricsHistory.get(projectName);
          buf.push(snapshot);
          if (buf.length > 60) buf.shift();

          // Evaluate alerts
          this.evaluateAlerts(projectName, snapshot);
        } catch {}
      }
    } catch {}
  }

  parseSizeToMb(str) {
    if (!str) return 0;
    const num = parseFloat(str) || 0;
    if (str.includes("GiB") || str.includes("GB") || str.includes("g")) return num * 1024;
    if (str.includes("MiB") || str.includes("MB") || str.includes("m")) return num;
    if (str.includes("KiB") || str.includes("KB") || str.includes("k")) return num / 1024;
    if (str.includes("B") || str.includes("b")) return num / 1048576;
    return num;
  }

  evaluateAlerts(projectName, snapshot) {
    try {
      const rules = this.db.prepare("SELECT * FROM alert_rules WHERE project=? AND enabled=1").all(projectName);
      for (const rule of rules) {
        let isTriggered = false;
        let val = 0;

        if (rule.metric_type === "cpu" && snapshot.cpuPercent >= rule.threshold) {
          isTriggered = true;
          val = snapshot.cpuPercent;
        } else if (rule.metric_type === "memory" && snapshot.memoryPercent >= rule.threshold) {
          isTriggered = true;
          val = snapshot.memoryPercent;
        }

        const alertKey = `${projectName}_${rule.metric_type}`;
        if (isTriggered) {
          if (!this.activeAlerts.has(alertKey)) {
            const alertObj = {
              id: `alt_${Date.now().toString(36)}`,
              project: projectName,
              metricType: rule.metric_type,
              value: val,
              threshold: rule.threshold,
              message: `High ${rule.metric_type.toUpperCase()} alert: currently at ${val}% (threshold: ${rule.threshold}%)`,
              triggeredAt: Date.now(),
            };
            this.activeAlerts.set(alertKey, alertObj);

            this.db.prepare(`
              INSERT INTO alert_history (id, project, metric_type, value, threshold, message, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'triggered', ?)
            `).run(alertObj.id, projectName, rule.metric_type, val, rule.threshold, alertObj.message, Date.now());
          }
        } else {
          if (this.activeAlerts.has(alertKey)) {
            const existing = this.activeAlerts.get(alertKey);
            this.activeAlerts.delete(alertKey);

            this.db.prepare(`
              INSERT INTO alert_history (id, project, metric_type, value, threshold, message, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'resolved', ?)
            `).run(`res_${Date.now().toString(36)}`, projectName, rule.metric_type, snapshot.cpuPercent, rule.threshold, `${rule.metric_type.toUpperCase()} normalized below threshold`, Date.now());
          }
        }
      }
    } catch {}
  }

  getServiceMetrics(projectName) {
    const clean = projectName ? projectName.toLowerCase().trim() : null;
    if (clean) {
      const history = this.metricsHistory.get(clean) || [];
      const latest = history[history.length - 1] || {
        timestamp: Date.now(),
        projectName: clean,
        cpuPercent: 0,
        memoryUsedMb: 0,
        memoryLimitMb: 1024,
        memoryPercent: 0,
        networkIo: "0B / 0B",
        blockIo: "0B / 0B",
      };

      return {
        project: clean,
        current: latest,
        history,
        activeAlerts: Array.from(this.activeAlerts.values()).filter((a) => a.project === clean),
      };
    }

    // All services summary
    const all = {};
    for (const [p, h] of this.metricsHistory.entries()) {
      all[p] = {
        current: h[h.length - 1] || null,
        dataPointsCount: h.length,
      };
    }
    return {
      services: all,
      activeAlerts: Array.from(this.activeAlerts.values()),
    };
  }

  getSystemMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPercent = Math.round((usedMem / totalMem) * 100);

    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) totalTick += cpu.times[type];
      totalIdle += cpu.times.idle;
    }
    const cpuUsage = Math.round(((totalTick - totalIdle) / totalTick) * 100) || 4;

    const loadAvg = os.loadavg ? os.loadavg() : [0.5, 0.4, 0.3];

    return {
      cpuUsagePercent: cpuUsage,
      cores: cpus.length,
      loadAverage: { "1m": Math.round(loadAvg[0] * 100) / 100, "5m": Math.round(loadAvg[1] * 100) / 100, "15m": Math.round(loadAvg[2] * 100) / 100 },
      memory: {
        totalMb: Math.round(totalMem / 1048576),
        usedMb: Math.round(usedMem / 1048576),
        freeMb: Math.round(freeMem / 1048576),
        usedPercent: memoryPercent,
      },
      uptimeSeconds: Math.round(os.uptime()),
      activeContainers: this.metricsHistory.size,
      activeAlertsCount: this.activeAlerts.size,
    };
  }

  /**
   * Search and filter service logs with level detection and regex
   */
  searchLogs(projectName, { query = "", level = "all", limit = 100 }) {
    const clean = projectName ? projectName.toLowerCase().trim() : "stirling-pdf";
    let rawLogs = "";

    // Try reading docker logs
    try {
      const containerName = `hx_${clean.replace(/[^a-z0-9_-]/g, "_")}`;
      const res = spawnSync("docker", ["logs", "--tail", String(limit * 2), containerName], {
        encoding: "utf8",
        timeout: 3000,
      });
      rawLogs = res.stdout || res.stderr || "";
    } catch {}

    // Fallback to disk logs
    if (!rawLogs) {
      const p = path.join(this.LOGDIR, `${clean}.log`);
      if (fs.existsSync(p)) {
        try {
          rawLogs = fs.readFileSync(p, "utf8");
        } catch {}
      }
    }

    if (!rawLogs) {
      return {
        projectName: clean,
        totalLines: 0,
        matchedLines: 0,
        logs: [],
        levelsCount: { error: 0, warn: 0, info: 0, debug: 0 },
      };
    }

    const lines = rawLogs.split("\n").filter(Boolean);
    const levelsCount = { error: 0, warn: 0, info: 0, debug: 0 };
    const parsed = [];

    const queryLower = query ? query.toLowerCase() : "";
    const filterLevel = level ? level.toLowerCase() : "all";

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      let logLevel = "info";

      if (/error|fatal|exception|fail|crash|oom/i.test(text)) {
        logLevel = "error";
        levelsCount.error++;
      } else if (/warn|deprecated|timeout|slow/i.test(text)) {
        logLevel = "warn";
        levelsCount.warn++;
      } else if (/debug|trace|verbose/i.test(text)) {
        logLevel = "debug";
        levelsCount.debug++;
      } else {
        levelsCount.info++;
      }

      // Filter by query and level
      const matchesQuery = !queryLower || text.toLowerCase().includes(queryLower);
      const matchesLevel = filterLevel === "all" || logLevel === filterLevel;

      if (matchesQuery && matchesLevel) {
        parsed.push({
          line: i + 1,
          level: logLevel,
          message: text,
        });
      }
    }

    return {
      projectName: clean,
      totalLines: lines.length,
      matchedLines: parsed.length,
      levelsCount,
      logs: parsed.slice(-limit),
    };
  }

  setAlertRule(projectName, metricType = "memory", threshold = 85) {
    const clean = projectName.toLowerCase().trim();
    const id = `rule_${clean}_${metricType}`;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO alert_rules (id, project, metric_type, threshold, duration_seconds, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, 60, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET threshold=excluded.threshold, updated_at=excluded.updated_at
    `).run(id, clean, metricType, Number(threshold), now, now);

    return {
      id,
      project: clean,
      metricType,
      threshold: Number(threshold),
      status: "active",
    };
  }

  listAlertRules(projectName) {
    if (projectName) {
      return this.db.prepare("SELECT * FROM alert_rules WHERE project=?").all(projectName.toLowerCase().trim());
    }
    return this.db.prepare("SELECT * FROM alert_rules").all();
  }

  listActiveAlerts() {
    return Array.from(this.activeAlerts.values());
  }

  startMetricsCollector() {
    // Initial run
    this.collectDockerMetrics();
    // Poll every 10 seconds
    this.timer = setInterval(() => this.collectDockerMetrics(), 10000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
