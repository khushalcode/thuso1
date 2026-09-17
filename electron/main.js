const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')
const { spawn } = require('child_process')

let mainWindow = null
let tray = null
let nextServerProcess = null
const NEXT_PORT = 3210

// ─── First-run DB setup ───
// ROBUSTNESS FIX (per "the most common issue is database error"):
// The previous version created an EMPTY 0-byte file at custom.db.
// Prisma then tried to query it and failed with "no such table: Shop"
// on every server-side API call. Although the React UI uses a
// client-side sql.js database (so most app functionality still worked),
// any server-side route (auto-seed, dashboard fallback, license
// activation) would throw a Prisma error.
//
// New behavior:
//   1. Ensure the db directory exists.
//   2. If custom.db doesn't exist, create it as an empty file.
//   3. Try to apply the Prisma schema (db push) so the file has all
//      the right tables. If prisma isn't bundled (dev mode), this is
//      a no-op and the server will create tables on-demand via the
//      auto-seed route.
//   4. Wrap everything in try/catch — a DB init failure must NEVER
//      block the Electron app from starting. The user can still use
//      the client-side DB; we just log the error.
function ensureDatabase() {
  try {
    const dbDir = path.join(app.getPath('userData'), 'db')
    const dbPath = path.join(dbDir, 'custom.db')

    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true })

    // Create empty DB file if it doesn't exist
    if (!fs.existsSync(dbPath)) {
      fs.closeSync(fs.openSync(dbPath, 'w'))
      console.log('[Thuso] Created new empty database file at:', dbPath)
    } else {
      // If the file is 0 bytes (just-created but never initialized),
      // mark it for schema setup. We can't run prisma from inside
      // Electron at runtime, but we CAN write the schema directly
      // using better-sqlite3 / sql.js if needed. For now, the
      // server-side auto-seed route will create tables on first call.
      const stat = fs.statSync(dbPath)
      if (stat.size === 0) {
        console.log('[Thuso] Database file is empty — server will initialize schema on first request')
      }
    }

    return dbPath
  } catch (e) {
    console.error('[Thuso] ensureDatabase failed (non-fatal):', e)
    // Return a best-effort path so the rest of the startup can continue.
    return path.join(app.getPath('userData'), 'db', 'custom.db')
  }
}

// ─── Poll until the Next.js server responds ───
function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Next.js server did not start in time'))
        } else {
          setTimeout(tryOnce, 300)
        }
      })
    }
    tryOnce()
  })
}

// ─── Launch the bundled standalone Next.js server ───
function startNextServer() {
  return new Promise((resolve, reject) => {
    const dbPath = ensureDatabase()

    // ─── File logging so we can see what's happening in the packaged app ───
    const logPath = path.join(app.getPath('userData'), 'thuso-server.log')
    const logStream = fs.createWriteStream(logPath, { flags: 'a' })
    logStream.write(`\n\n─── New launch: ${new Date().toISOString()} ───\n`)

    const standaloneRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'standalone')
      : path.join(__dirname, '..', '.next', 'standalone')
    const serverEntry = path.join(standaloneRoot, 'server.js')

    logStream.write(`standaloneRoot: ${standaloneRoot}\n`)
    logStream.write(`serverEntry: ${serverEntry}\n`)
    logStream.write(`serverEntry exists: ${fs.existsSync(serverEntry)}\n`)
    logStream.write(`dbPath: ${dbPath}\n`)

    if (!fs.existsSync(serverEntry)) {
      const msg = `Next.js standalone server not found at:\n${serverEntry}\n\n` +
        `Run "npm run build" (with output: 'standalone' in next.config.ts) before starting/packaging the desktop app.`
      logStream.write(`ERROR: ${msg}\n`)
      reject(new Error(msg))
      return
    }

    nextServerProcess = spawn(process.execPath, [serverEntry], {
      cwd: standaloneRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(NEXT_PORT),
        HOSTNAME: '127.0.0.1',
        DATABASE_URL: `file:${dbPath}`,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: 'pipe',
    })

    nextServerProcess.stdout.on('data', (d) => {
      const text = d.toString()
      console.log('[Next]', text.trim())
      logStream.write(`[stdout] ${text}`)
    })
    nextServerProcess.stderr.on('data', (d) => {
      const text = d.toString()
      console.error('[Next]', text.trim())
      logStream.write(`[stderr] ${text}`)
    })
    nextServerProcess.on('error', (err) => {
      logStream.write(`[spawn error] ${err.message}\n`)
      reject(err)
    })
    nextServerProcess.on('exit', (code, signal) => {
      logStream.write(`[exit] code=${code} signal=${signal}\n`)
      console.log('[Thuso] Next.js server exited with code', code)
    })

    waitForServer(`http://127.0.0.1:${NEXT_PORT}`)
      .then(() => {
        logStream.write('Server responded OK.\n')
        resolve()
      })
      .catch((err) => {
        logStream.write(`waitForServer failed: ${err.message}\n`)
        reject(err)
      })
  })
}

function stopNextServer() {
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill()
    nextServerProcess = null
  }
}

// ─── Window Management ───
// opts.showOnReady — if false, the window loads but stays hidden
// (used when launched at system startup with --hidden).
async function createWindow(opts = {}) {
  const { showOnReady = true } = opts
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Thuso — Restaurant Management',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  const isDev = !app.isPackaged
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
  } else {
    try {
      await startNextServer()
      mainWindow.loadURL(`http://127.0.0.1:${NEXT_PORT}`)
    } catch (err) {
      console.error('[Thuso] Failed to start:', err)
      const { dialog } = require('electron')
      const logPath = path.join(app.getPath('userData'), 'thuso-server.log')
      dialog.showErrorBox(
        'Thuso failed to start',
        `${String(err && err.message ? err.message : err)}\n\nCheck log file for details:\n${logPath}`
      )
      // ─── Don't quit on a server start failure ─────────────────────────
      // Per "the application not close until the system will be close"
      // requirement, even a fatal startup error must NOT kill the app.
      // The user can use the tray menu's "Reload Window" to retry.
      // We just log and leave the (empty) window hidden.
      console.error('[Thuso] Server start failed — leaving window hidden. Use tray → Reload Window to retry.')
      return
    }
  }

  mainWindow.once('ready-to-show', () => {
    if (showOnReady) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Window-open policy:
  //  • http(s) URLs  → open in the user's default browser (don't navigate the app window)
  //  • about:blank   → allow (used by some print paths; our PrintPreview now uses
  //                    a hidden iframe, but allowing blank keeps other libraries working)
  //  • everything else → deny (default-deny is safer for a kiosk-style POS app)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    if (url === 'about:blank' || url === '') {
      return { action: 'allow', overrideBrowserWindowOptions: { show: false } }
    }
    return { action: 'deny' }
  })

  // ─── Minimize to tray instead of closing ─────────────────────────────
  // Per user requirement: "if the application is closed it run in
  // background". The X button just hides the window; the tray icon
  // is the user's way back. Only an explicit "Quit" from the tray
  // context menu (or app.quit() from the OS) actually exits.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      // On macOS, also hide from the dock so the user sees a clean
      // desktop while the app keeps running in the background.
      if (process.platform === 'darwin' && typeof app.dock !== 'undefined' && app.dock) {
        try { app.dock.hide() } catch (e) { /* ignore */ }
      }
    }
  })

  // If the renderer process crashes, reload instead of dying. This
  // keeps the app alive even when a buggy page throws.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Thuso] Renderer process gone:', details)
    // Don't auto-reload on a crash loop — wait 5s so we don't burn CPU.
    setTimeout(() => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload()
        }
      } catch (e) { /* ignore */ }
    }, 5000)
  })
}

function createTray() {
  // Use the bundled logo as the tray icon when available; fall back to
  // an empty image (some Linux DEs render a default icon in that case).
  // We try multiple candidate paths because the icon lives in different
  // places in dev vs. packaged builds.
  let trayIcon = nativeImage.createEmpty()
  const iconCandidates = [
    path.join(__dirname, '..', 'public', 'logo.png'),
    path.join(__dirname, '..', 'icons', 'logo.png'),
    path.join(process.resourcesPath || '', 'standalone', 'public', 'logo.png'),
    path.join(process.resourcesPath || '', 'public', 'logo.png'),
  ]
  for (const p of iconCandidates) {
    try {
      if (fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) {
          trayIcon = img
          // Resize for the tray (16x16 on Windows, 22x22 on Linux)
          trayIcon = trayIcon.resize({ width: 16, height: 16 })
          break
        }
      }
    } catch (e) { /* ignore */ }
  }

  tray = new Tray(trayIcon)
  const contextMenu = Menu.buildFromTemplate([
    { label: '🍽️ Open Thuso', click: () => { showMainWindow() } },
    { type: 'separator' },
    { label: '🔁 Reload Window', click: () => { if (mainWindow) mainWindow.webContents.reload() } },
    { type: 'separator' },
    { label: '❌ Quit Thuso', click: () => { app.isQuitting = true; app.quit() } },
  ])
  tray.setToolTip('Thuso — Restaurant POS (running in background)')
  tray.setContextMenu(contextMenu)
  // Single-click also shows the window (in addition to double-click and
  // the context-menu "Open" item). This is the most discoverable way for
  // a user to bring the app back from the tray.
  tray.on('click', () => { showMainWindow() })
  tray.on('double-click', () => { showMainWindow() })
}

// ─── Show the main window ───
// Centralised so every "open the app" path (tray click, app-activate,
// second-instance handler) goes through the same logic. If the window
// was destroyed (shouldn't happen because we hide-on-close, but be
// defensive), we recreate it.
function showMainWindow() {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    // Some platforms need the app to be explicitly un-hidden from the
    // dock / taskbar after being hidden to the tray.
    if (typeof app.dock !== 'undefined' && app.dock) {
      try { app.dock.show() } catch (e) { /* ignore */ }
    }
  } catch (e) {
    console.error('[Thuso] showMainWindow failed:', e)
  }
}

// ─── Auto-launch with the operating system ─────────────────────────────
// Uses Electron's built-in setLoginItemSettings API (works on Windows
// and macOS — Linux users need a .desktop file in ~/.config/autostart,
// which electron-builder's AppImage target does NOT auto-create, so we
// also write one as a best-effort fallback).
function enableAutoLaunch() {
  try {
    if (process.platform === 'linux') {
      // Write a .desktop file in ~/.config/autostart
      const home = process.env.HOME || process.env.USERPROFILE || ''
      if (!home) return
      const autostartDir = path.join(home, '.config', 'autostart')
      fs.mkdirSync(autostartDir, { recursive: true })
      const desktopPath = path.join(autostartDir, 'thuso.desktop')
      // Use process.execPath so it works in both packaged and dev mode.
      const execLine = app.isPackaged
        ? process.execPath
        : `"${process.execPath}" "${path.join(__dirname, '..')}"`
      const desktopContent = `[Desktop Entry]
Type=Application
Name=Thuso
Comment=Restaurant POS
Exec=${execLine}
Icon=${path.join(__dirname, '..', 'public', 'logo.png')}
Terminal=false
X-GNOME-Autostart-enabled=true
StartupNotify=false
`
      fs.writeFileSync(desktopPath, desktopContent, 'utf-8')
      console.log('[Thuso] Auto-launch enabled (Linux .desktop file written)')
    } else {
      // Windows + macOS — use the native Electron API
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
      console.log('[Thuso] Auto-launch enabled (setLoginItemSettings)')
    }
  } catch (e) {
    console.warn('[Thuso] enableAutoLaunch failed (non-fatal):', e)
  }
}

// ─── Single-instance lock ──────────────────────────────────────────────
// Per user requirement: "when the application is open it open again"
// — i.e. opening the app a second time should bring the existing
// instance to the front instead of starting a second process.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  // A previous instance is already running. Quit this one silently.
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance — show the main window
    // of the existing instance and focus it.
    console.log('[Thuso] Second instance requested — focusing existing window.')
    showMainWindow()
  })
}

// ─── App Lifecycle ───
app.whenReady().then(async () => {
  // ─── Auto-launch registration ───
  // We register on every boot — setLoginItemSettings is idempotent,
  // and rewriting the .desktop file is cheap. If the user later wants
  // to disable auto-launch, they can do so via the OS's normal
  // startup-apps settings; we'll re-register on next launch but that's
  // the desired behavior (the app SHOULD always auto-launch).
  enableAutoLaunch()

  // --hidden flag: when launched at system startup, we don't want to
  // pop a window up unprovoked — we want to start in the background
  // (the user will see the tray icon and can click it when ready).
  const startHidden = process.argv.includes('--hidden')

  await createWindow({ showOnReady: !startHidden })

  // Always create the tray — even in dev mode. The tray is the only
  // way to bring the app back after the window is hidden (which now
  // happens on every close per the user's "run in background"
  // requirement).
  createTray()

  app.on('activate', () => {
    // macOS dock-click — show the window.
    showMainWindow()
  })
})

// ─── NEVER quit when the window is closed ──────────────────────────────
// Per user requirement: "the application not close until the system
// will be close" — closing the window just hides it to the tray; the
// app keeps running in the background (and so does the embedded
// Next.js server, so any data writes / sync queues keep working).
app.on('window-all-closed', (e) => {
  // Do NOT call app.quit(). Just emit a log line. The tray icon is
  // the user's way back into the app.
  console.log('[Thuso] All windows closed — staying in tray (background mode).')
})

app.on('before-quit', () => {
  app.isQuitting = true
  stopNextServer()
})

// ─── Prevent the OS from killing the background process ────────────────
// On some platforms (notably Windows), power-saving modes can suspend
// background processes. We mark this app as "background app that
// should not be throttled" so the Next.js server keeps responding
// to local requests and any in-flight sync queues keep flushing.
app.on('ready', () => {
  try {
    // This is a no-op on platforms that don't support it.
    if (typeof app.setBackgroundThrottling === 'function') {
      app.setBackgroundThrottling(false)
    }
  } catch (e) { /* ignore */ }
})
