/**
 * Electron Main Entry Point
 */

import { app, BrowserWindow, session, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createContainer, type Container } from './container';
import { registerIpcHandlers, getTempFiles } from './ipc';
import { cleanupOllamaProcess } from '../adapters/ollama-manager';

let mainWindow: BrowserWindow | null = null;
let container: Container | null = null;

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

// Content Security Policy
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Note: 'unsafe-inline' required for React inline styles (style={}) used extensively for:
  // - Dynamic values (progress bars, tag colors from database)
  // - CSS custom properties (var(--color-*) for theming)
  // - Platform-specific styles (-webkit-app-region for macOS titlebar)
  // Risk is mitigated by: (1) DOMPurify sanitization of all email HTML, (2) explicit stripping of
  // CSS attack vectors (expression(), javascript:, behavior:, -moz-binding:) in EmailViewer.tsx
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: file:",  // Allow local images, HTTPS external images, and data URIs
  "font-src 'self'",
  "connect-src 'self' https://api.anthropic.com",  // LLM API
  "frame-src 'none'",
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

  // Restrict navigation to trusted origins only
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = [
      'http://localhost:5173',  // Dev server
      'file://',                // Production build
    ];
    const isAllowed = allowed.some(origin => url.startsWith(origin));
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
  if (process.env.NODE_ENV === 'development') {
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
