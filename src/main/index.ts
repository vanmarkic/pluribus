/**
 * Electron Main Entry Point
 */

import { app, BrowserWindow, session, shell } from 'electron';
import * as path from 'path';
import { createContainer, type Container } from './container';
import { registerIpcHandlers } from './ipc';

let mainWindow: BrowserWindow | null = null;
let container: Container | null = null;

// Content Security Policy
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",  // Tailwind needs inline styles
  "img-src 'self' data: file:",  // Blocks tracking pixels - only allow local/cached images
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
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', async () => {
  await container?.shutdown();
});

// Error handling
process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));
