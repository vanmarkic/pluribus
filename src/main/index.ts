/**
 * Electron Main Entry Point
 */

import { app, BrowserWindow, session, shell, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { createContainer, type Container } from './container';
import { registerIpcHandlers, getTempFiles } from './ipc';
import { cleanupOllamaProcess } from '../adapters/ollama-manager';
import { startOllamaOnLaunch } from '../core/usecases/ollama-usecases';

let mainWindow: BrowserWindow | null = null;
let container: Container | null = null;

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

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
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

  // Set CSP headers for all requests
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  // Initialize container and IPC
  container = createContainer();
  registerIpcHandlers(mainWindow, container);

  // Start Ollama in background (non-blocking)
  const llmConfig = container.config.get('llm');
  startOllamaOnLaunch({
    runner: container.ollamaManager,
    config: {
      provider: llmConfig.provider,
    },
  }).then((result) => {
    if (result.started) {
      console.log('[Main] Ollama started successfully');
    } else if (result.reason === 'start-failed') {
      console.error('[Main] Failed to start Ollama:', result.error);
    } else {
      console.log('[Main] Ollama auto-start skipped:', result.reason);
    }
  });

  // Restrict navigation to trusted origins only
  mainWindow.webContents.on('will-navigate', (event, url) => {
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // For external links, open in system browser instead
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load app
  if (!app.isPackaged) {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  registerCachedImageProtocol(); // Register custom protocol for serving cached images
  cleanupTempFiles(); // Clean up temp files on startup
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', async () => {
  cleanupTempFiles(); // Clean up temp files on quit
  cleanupOllamaProcess(); // Clean up Ollama process on quit
  await container?.shutdown();
});

// Error handling
process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));
