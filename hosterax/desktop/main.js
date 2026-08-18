// hosterax/desktop/main.js
// Electron Native Desktop Supervisor & Application Shell for HosteraX
// Automatically launches the embedded engine daemon and renders the web control plane.

const { app, BrowserWindow, Tray, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

let mainWindow = null;
let engineProcess = null;
let tray = null;

const ENGINE_PORT = process.env.HOSTERAX_PORT || 7777;
const UI_URL = `http://localhost:${ENGINE_PORT}`;

function getEnginePath() {
  const candidates = [
    path.join(__dirname, "engine", "index.mjs"),
    path.join(__dirname, "engine", "src", "index.mjs"),
    path.join(__dirname, "..", "engine", "src", "index.mjs"),
    path.join(process.resourcesPath || "", "engine", "index.mjs"),
    path.join(process.resourcesPath || "", "app", "engine", "index.mjs"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "engine", "index.mjs"),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

async function isEngineHealthy(url = UI_URL) {
  try {
    const res = await fetch(url + "/health", { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startEngineDaemon() {
  if (await isEngineHealthy()) {
    console.log(`[HosteraX Desktop] Engine already running on port ${ENGINE_PORT}`);
    return;
  }

  const engineEntry = getEnginePath();
  console.log(`[HosteraX Desktop] Launching embedded Engine daemon: ${engineEntry}`);

  if (!engineEntry) {
    console.error("[HosteraX Desktop Error] Could not find embedded engine entrypoint.");
    return;
  }

  try {
    // Launch using Electron executable running in Node mode (no external node.exe required)
    engineProcess = spawn(process.execPath, [engineEntry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        HOSTERAX_PORT: String(ENGINE_PORT),
        NODE_ENV: "production",
      },
      stdio: "pipe",
    });

    engineProcess.stdout?.on("data", (d) => process.stdout.write(`[Engine] ${d}`));
    engineProcess.stderr?.on("data", (d) => process.stderr.write(`[Engine ERR] ${d}`));

    engineProcess.on("exit", (code) => {
      console.log(`[HosteraX Desktop] Engine process exited with code ${code}`);
    });
  } catch (err) {
    console.error("[HosteraX Desktop Error] Failed to spawn engine daemon:", err);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "HosteraX Autonomous Cloud Control Plane",
    backgroundColor: "#090d16",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Wait for the embedded engine to be live
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (await isEngineHealthy()) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[HosteraX Desktop] Loading Web Control Plane: ${UI_URL} (ready=${ready})`);
  mainWindow.loadURL(UI_URL).catch(() => {
    setTimeout(() => mainWindow && mainWindow.loadURL(UI_URL), 2000);
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
    if (fs.existsSync(iconPath)) {
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        { label: "HosteraX Control Plane", click: () => mainWindow && mainWindow.show() },
        { type: "separator" },
        {
          label: "Restart Engine Daemon",
          click: async () => {
            if (engineProcess) engineProcess.kill();
            await startEngineDaemon();
            if (mainWindow) mainWindow.loadURL(UI_URL);
          },
        },
        { label: "Quit HosteraX", click: () => app.quit() },
      ]);
      tray.setToolTip("HosteraX Control Plane");
      tray.setContextMenu(contextMenu);
    }
  } catch {}
}

app.whenReady().then(async () => {
  await startEngineDaemon();
  await createWindow();
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
    try {
      engineProcess.kill();
    } catch {}
  }
});
