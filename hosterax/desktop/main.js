// hosterax/desktop/main.js
// Electron 40 Native Desktop Supervisor & Application Shell for HosteraX
// Automatically launches and supervises local engine daemon and provides system tray integration.

const { app, BrowserWindow, Tray, Menu, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let mainWindow = null;
let engineProcess = null;
let tray = null;

const ENGINE_PORT = process.env.HOSTERAX_PORT || 7777;
const UI_URL = process.env.HOSTERAX_UI_URL || `http://localhost:${ENGINE_PORT}`;

function startEngineDaemon() {
  const engineEntry = path.join(__dirname, "../engine/src/index.mjs");
  console.log(`[HosteraX Desktop] Launching embedded Engine daemon: ${engineEntry}`);

  engineProcess = spawn("node", [engineEntry], {
    env: { ...process.env, HOSTERAX_PORT: String(ENGINE_PORT) },
    stdio: "pipe",
  });

  engineProcess.stdout.on("data", (d) => process.stdout.write(`[Engine] ${d}`));
  engineProcess.stderr.on("data", (d) => process.stderr.write(`[Engine ERR] ${d}`));

  engineProcess.on("exit", (code) => {
    console.log(`[HosteraX Desktop] Engine exited with code ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "HosteraX Autonomous Cloud Control Plane",
    backgroundColor: "#090d16",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(UI_URL).catch(() => {
    // If frontend dev server or engine takes a few seconds to boot, retry
    setTimeout(() => mainWindow.loadURL(UI_URL), 2000);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, "icon.png");
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: "HosteraX Control Plane", click: () => mainWindow && mainWindow.show() },
      { type: "separator" },
      {
        label: "Restart Engine Daemon",
        click: () => {
          if (engineProcess) engineProcess.kill();
          startEngineDaemon();
        },
      },
      { label: "Quit HosteraX", click: () => app.quit() },
    ]);
    tray.setToolTip("HosteraX Control Plane");
    tray.setContextMenu(contextMenu);
  } catch {}
}

app.whenReady().then(() => {
  startEngineDaemon();
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (engineProcess) {
    console.log("[HosteraX Desktop] Terminating engine process...");
    engineProcess.kill();
  }
});
