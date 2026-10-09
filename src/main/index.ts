/**
 * Electron Main Entry Point
 *
 * Lifecycle in one place:
 * - Process-wide work (protocol, CSP, container, IPC handlers, Ollama, the
 *   daily-digest runtime, the System 1 retrain job) happens ONCE, in `startApp()`,
 *   when the app is ready.
 * - The window is just a view onto that. It is created by the window manager
 *   (`showWindow()`), may be closed and re-created any number of times, and
 *   nothing process-wide is tied to it. On macOS the app keeps running after
 *   the last window closes so the 09:00 digest can still fire.
 * - A single-instance lock guarantees two copies never both run the digest.
 */

import { app, BrowserWindow, dialog, session, shell, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { createContainer, getModelsDir, type Container } from './container';
import { registerIpcHandlers, getTempFiles } from './ipc';
import { createDigestRuntime, type DigestRuntime } from './digest-wiring';
import { createSystem1Runtime, type System1Runtime } from './system1-wiring';
import { logger } from '../adapters/observability';
import { readSystem1Settings } from '../core/system1/settings';
import { createWindowManager } from './window-manager';
import {
  createActivationGuard,
  createLoginItemController,
  createLoginItemSync,
} from './login-item';
import { cleanupOllamaProcess } from '../adapters/ollama-manager';
import { startOllamaOnLaunch } from '../core/usecases/ollama-usecases';

let container: Container | null = null;
let digestRuntime: DigestRuntime | null = null;
let system1Runtime: System1Runtime | null = null;

// ==========================================
// Custom Protocol for Cached Images
// ==========================================

// Register custom protocol scheme before app is ready
// This allows cached images to be served securely to the renderer
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'cached-image',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

/**
 * Register the cached-image:// protocol handler
 * Format: cached-image://email/{emailId}/{filename}
 */
function registerCachedImageProtocol(): void {
  protocol.handle('cached-image', (request) => {
    const url = new URL(request.url);
    // Parse: cached-image://email/{emailId}/{filename}
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts[0] !== 'email' || pathParts.length < 3) {
      return new Response('Invalid path', { status: 400 });
    }

    const emailId = pathParts[1];
    const filename = pathParts.slice(2).join('/');
    if (!emailId) return new Response('Missing email id', { status: 400 });

    // Construct the file path
    const cacheDir = path.join(app.getPath('userData'), 'cache', 'images', emailId);
    const filePath = path.join(cacheDir, filename);

    // Security: Ensure the path is within the cache directory. The
    // separator check stops a sibling-prefix escape (e.g. cache dir
    // ".../images/1" must not match ".../images/12/secret").
    const realPath = path.resolve(filePath);
    const realCacheDir = path.resolve(cacheDir);
    if (realPath !== realCacheDir && !realPath.startsWith(realCacheDir + path.sep)) {
      console.warn('Attempted path traversal:', filePath);
      return new Response('Forbidden', { status: 403 });
    }

    // Check if file exists
    if (!fs.existsSync(realPath)) {
      return new Response('Not found', { status: 404 });
    }

    // Use net.fetch with file:// URL to serve the file
    return net.fetch(pathToFileURL(realPath).href);
  });
}

// ==========================================
// Temp File Cleanup
// ==========================================

function cleanupTempFiles(): void {
  // Clean up tracked temp files
  for (const file of getTempFiles()) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (error) {
      console.error('Failed to cleanup temp file:', file, error);
    }
  }
  getTempFiles().clear();

  // Clean up entire temp directory
  const tempDir = path.join(app.getPath('temp'), 'mail-attachments');
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(tempDir, file));
        } catch (error) {
          console.error('Failed to cleanup temp directory file:', file, error);
        }
      }
    }
  } catch (error) {
    console.error('Failed to cleanup temp directory:', error);
  }
}

// Content Security Policy (#100)
//
// 'unsafe-inline' on style-src is the single remaining relaxation — React's
// inline `style={{}}` props compile to inline style attributes and there is
// no practical nonce strategy in React 18 without introducing a wrapping
// layer. Risk is mitigated by (a) DOMPurify on every email body, (b)
// explicit CSS-vector stripping in EmailViewer.tsx (expression(),
// javascript:, behavior:, -moz-binding:), and (c) frame-ancestors 'none'
// which prevents the window from being embedded and used as an injection
// vector. See docs/security/csp.md for the full rationale and roadmap to
// remove 'unsafe-inline' entirely.
const isDev = process.env.NODE_ENV === 'development';
const CSP = [
  "default-src 'self'",
  isDev ? "script-src 'self' 'unsafe-inline' http://localhost:5173" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: cached-image:",
  "font-src 'self'",
  isDev
    ? "connect-src 'self' https://api.anthropic.com http://localhost:5173 ws://localhost:5173"
    : "connect-src 'self' https://api.anthropic.com",
  "worker-src 'self' blob:", // xenova/transformers spawns ONNX workers
  "frame-src 'none'",
  "frame-ancestors 'none'", // clickjacking defence
  "form-action 'self'", // phishing defence
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

/**
 * Build one BrowserWindow and load the renderer into it. Window-only work:
 * no container, IPC or CSP setup here (that happens once in `startApp()`).
 * Tracking and clearing the reference on 'closed' is the window manager's job.
 */
async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Restrict navigation to trusted origins only
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = [
      'http://localhost:5173', // Dev server
      'file://', // Production build
    ];
    const isAllowed = allowed.some((origin) => url.startsWith(origin));
    if (!isAllowed) {
      event.preventDefault();
      console.warn('Blocked navigation to:', url);
    }
  });

  // Block all new windows / popups
  win.webContents.setWindowOpenHandler(({ url }) => {
    // For external links, open in system browser instead
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load app. A failed load (dev server down, window closed while loading)
  // must not reject: the window exists either way, and the manager needs to
  // track it so it is reused rather than duplicated on the next activation.
  try {
    if (!app.isPackaged) {
      await win.loadURL('http://localhost:5173');
      win.webContents.openDevTools();
    } else {
      await win.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
  } catch (error) {
    console.error('[Main] Failed to load the renderer:', error);
  }

  return win;
}

/** The one window of the app (see window-manager.ts). */
const windowManager = createWindowManager({ createBrowserWindow: createMainWindow });

/** Set the Content-Security-Policy header on every response (once per process). */
function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });
}

/** Start Ollama in the background (non-blocking, failures are logged only). */
function startOllamaInBackground(c: Container): void {
  const llmConfig = c.config.get('llm');
  startOllamaOnLaunch({
    runner: c.ollamaManager,
    config: {
      provider: llmConfig.provider,
    },
  })
    .then((result) => {
      if (result.started) {
        console.log('[Main] Ollama started successfully');
      } else if (result.reason === 'start-failed') {
        console.error('[Main] Failed to start Ollama:', result.error);
      } else {
        console.log('[Main] Ollama auto-start skipped:', result.reason);
      }
    })
    .catch((error) => console.error('[Main] Ollama auto-start crashed:', error));
}

/**
 * Process-wide startup. Runs exactly once, when the app is ready. Closing and
 * re-opening the window never goes through here.
 */
async function startApp(): Promise<void> {
  registerCachedImageProtocol(); // Register custom protocol for serving cached images
  cleanupTempFiles(); // Clean up temp files on startup
  installContentSecurityPolicy();

  const c = createContainer();
  container = c;

  // System 1 (on-device classifier): nightly retrain + "import model from folder".
  // Built before the IPC handlers because the import channel needs it.
  const system1 = createSystem1Runtime({
    useCases: c.useCases,
    deps: c.deps,
    getSettings: () => readSystem1Settings(c.deps.config),
    cacheDir: getModelsDir(),
    logger,
  });
  system1Runtime = system1;

  // Handlers look the window up per event; there is no window yet.
  registerIpcHandlers(() => windowManager.getWindow(), c, {
    importModel: system1.importModel,
    downloadModel: system1.downloadModel,
  });
  startOllamaInBackground(c);

  const runtime = createDigestRuntime({
    useCases: c.useCases,
    digestConfig: c.deps.digestConfig,
    digestOpen: c.digestOpen,
    getWindow: () => windowManager.getWindow(),
    showWindow: () => windowManager.showWindow(),
  });
  digestRuntime = runtime;
  // The notifier was built before the runtime existed; a click on the digest
  // notification now opens the Needs-your-reply view.
  c.setOpenNeedsReplyHandler(() => void runtime.openNeedsReply());

  // Launch at login: register (once) and follow the digest setting from then on.
  const loginItem = createLoginItemSync({
    controller: createLoginItemController({
      app,
      log: (message, err) => logger.warn({ err }, message),
    }),
    getSettings: () => c.deps.digestConfig.getSettings(),
    getState: () => c.deps.digestConfig.getState(),
    setState: (state) => c.deps.digestConfig.setState(state),
  });
  c.config.onChange('digest', (digest) => {
    loginItem.onSettingsChanged(digest);
  });
  loginItem.reconcileAtStartup();
  // Started by the OS at login: stay in the background, no window.
  const startHidden = loginItem.shouldStartHidden();
  const activationGuard = createActivationGuard();

  // macOS: dock-icon click (or relaunch) with no window open. Registered after
  // the IPC handlers exist, so a window is never created ahead of them.
  app.on('activate', () => {
    if (activationGuard.shouldIgnoreActivation()) return; // launch-time activation after a hidden start
    void windowManager.showWindow().catch((error) => {
      console.error('[Main] Could not open the window:', error);
    });
  });
  // A second launch hands over to this instance (see the lock below).
  app.on('second-instance', () => {
    void windowManager.showWindow().catch((error) => {
      console.error('[Main] Could not open the window:', error);
    });
  });

  // The first window (none when the OS started us at login). If it fails to
  // come up the digest must still run.
  if (startHidden) {
    console.log('[Main] Started at login: running in the background without a window');
    activationGuard.arm();
  } else {
    try {
      await windowManager.showWindow();
    } catch (error) {
      console.error('[Main] Could not open the window:', error);
    }
  }
  try {
    runtime.start();
  } catch (error) {
    console.error('[Main] Could not start the daily digest:', error);
  }
  try {
    system1.start();
  } catch (error) {
    console.error('[Main] Could not start the System 1 retrain job:', error);
  }
}

async function shutdownApp(): Promise<void> {
  digestRuntime?.stop(); // no digest run may start while we are quitting
  system1Runtime?.stop(); // nor a System 1 retrain
  cleanupTempFiles(); // Clean up temp files on quit
  cleanupOllamaProcess(); // Clean up Ollama process on quit
  const c = container;
  container = null; // 'before-quit' can fire more than once: shut down once
  try {
    await c?.shutdown();
  } catch (error) {
    console.error('[Main] Shutdown failed:', error);
  }
}

// App lifecycle
//
// Only one instance may run: each instance would run its own digest scheduler
// and email the digest to the user twice. A second launch quits immediately,
// and only the lock holder registers the handlers below (the loser's
// 'before-quit' must not wipe the running instance's temp files).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app
    .whenReady()
    .then(startApp)
    .catch((error) => {
      console.error('[Main] Startup failed:', error);
      dialog.showErrorBox(
        'Mail could not start',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });

  // macOS keeps running without a window (the daily digest still fires);
  // elsewhere closing the last window quits.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    void shutdownApp();
  });
}

// Error handling
process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));
