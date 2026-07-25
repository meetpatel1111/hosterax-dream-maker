// HosteraX desktop shell — spawns engine as child, loads dashboard.
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");

let engine;
function startEngine() {
  const entry = path.join(__dirname, "..", "engine", "src", "index.mjs");
  engine = spawn("node", [entry], {
    env: { ...process.env, HOSTERAX_PORT: "7777" },
    stdio: "inherit",
  });
  engine.on("exit", (c) => console.log("engine exited", c));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900,
    title: "HosteraX",
    backgroundColor: "#0a0a0a",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Dashboard URL: override with HOSTERAX_DASHBOARD_URL (e.g. deployed Lovable URL)
  // Default: local built dashboard if present, else engine health page.
  const url = process.env.HOSTERAX_DASHBOARD_URL
    || "file://" + path.join(__dirname, "index.html");
  win.loadURL(url);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

app.whenReady().then(() => { startEngine(); setTimeout(createWindow, 500); });
app.on("window-all-closed", () => { if (engine) try { engine.kill(); } catch {} app.quit(); });
