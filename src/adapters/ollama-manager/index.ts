/**
 * Ollama Manager
 *
 * Manages the bundled Ollama binary and models.
 * Downloads binary on first run, handles lifecycle, and model management.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

// Types
export type DownloadProgress = {
  phase: 'binary' | 'model';
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  modelName?: string;
};

export type OllamaModel = {
  name: string;
  size: number;
  modifiedAt: string;
};

export type OllamaManager = {
  getOllamaPath: () => string;
  getModelsPath: () => string;
  getServerUrl: () => string;
  isInstalled: () => Promise<boolean>;
  downloadBinary: (onProgress: (progress: DownloadProgress) => void) => Promise<void>;
  isRunning: () => Promise<boolean>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  listLocalModels: () => Promise<OllamaModel[]>;
  pullModel: (name: string, onProgress: (progress: DownloadProgress) => void) => Promise<void>;
  deleteModel: (name: string) => Promise<void>;
};

// Constants
const OLLAMA_DOWNLOAD_URL = 'https://github.com/ollama/ollama/releases/latest/download/ollama-darwin';
const OLLAMA_PORT = 11435; // Different from default 11434 to avoid conflicts
const SERVER_URL = `http://127.0.0.1:${OLLAMA_PORT}`;

// Curated models for email classification
export const RECOMMENDED_MODELS = [
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2',
    description: 'Best overall accuracy',
    size: '2.0 GB',
    sizeBytes: 2_000_000_000,
  },
  {
    id: 'mistral:7b',
    name: 'Mistral 7B',
    description: 'Excellent for French & European languages',
    size: '4.1 GB',
    sizeBytes: 4_100_000_000,
  },
  {
    id: 'phi3:mini',
    name: 'Phi-3 Mini',
    description: 'Smaller, faster, good for older machines',
    size: '2.2 GB',
    sizeBytes: 2_200_000_000,
  },
];

// Module-level state for the spawned process
let ollamaProcess: ChildProcess | null = null;

export function createOllamaManager(): OllamaManager {
  const basePath = path.join(app.getPath('userData'), 'ollama');
  const binPath = path.join(basePath, 'bin', 'ollama');
  const modelsPath = path.join(basePath, 'models');

  return {
    getOllamaPath: () => binPath,
    getModelsPath: () => modelsPath,
    getServerUrl: () => SERVER_URL,

    async isInstalled(): Promise<boolean> {
      try {
        const stats = await fs.stat(binPath);
        // Check if file exists and is executable (has any execute bit)
        const isExecutable = (stats.mode & 0o111) !== 0;
        return stats.isFile() && isExecutable;
      } catch {
        return false;
      }
    },

    async downloadBinary(onProgress: (progress: DownloadProgress) => void): Promise<void> {
      // Ensure directories exist
      await fs.mkdir(path.dirname(binPath), { recursive: true });

      console.log('[OllamaManager] Downloading Ollama binary from:', OLLAMA_DOWNLOAD_URL);

      const response = await fetch(OLLAMA_DOWNLOAD_URL, {
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new Error(`Failed to download Ollama: HTTP ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
      let bytesDownloaded = 0;

      // Create a transform stream to track progress
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response body reader');
      }

      const writeStream = createWriteStream(binPath);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          writeStream.write(value);
          bytesDownloaded += value.length;

          const percent = totalBytes > 0 ? Math.round((bytesDownloaded / totalBytes) * 100) : 0;
          onProgress({
            phase: 'binary',
            percent,
            bytesDownloaded,
            totalBytes,
          });
        }

        writeStream.end();

        // Wait for write to complete
        await new Promise<void>((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });

        // Make executable
        await fs.chmod(binPath, 0o755);

        console.log('[OllamaManager] Binary downloaded and made executable');
      } catch (err) {
        // Clean up partial download
        await fs.unlink(binPath).catch(() => {});
        throw err;
      }
    },

    async isRunning(): Promise<boolean> {
      try {
        const response = await fetch(`${SERVER_URL}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    async start(): Promise<void> {
      // Check if already running
      if (await this.isRunning()) {
        console.log('[OllamaManager] Server already running');
        return;
      }

      // Check if binary exists
      if (!(await this.isInstalled())) {
        throw new Error('Ollama binary not installed. Call downloadBinary() first.');
      }

      // Ensure models directory exists
      await fs.mkdir(modelsPath, { recursive: true });

      console.log('[OllamaManager] Starting Ollama server...');

      // Spawn ollama serve with isolated environment
      ollamaProcess = spawn(binPath, ['serve'], {
        env: {
          ...process.env,
          OLLAMA_HOST: `127.0.0.1:${OLLAMA_PORT}`,
          OLLAMA_MODELS: modelsPath,
        },
        detached: false,
        stdio: 'pipe',
      });

      ollamaProcess.stdout?.on('data', (data) => {
        console.log('[Ollama]', data.toString().trim());
      });

      ollamaProcess.stderr?.on('data', (data) => {
        console.error('[Ollama]', data.toString().trim());
      });

      ollamaProcess.on('error', (err) => {
        console.error('[OllamaManager] Process error:', err);
        ollamaProcess = null;
      });

      ollamaProcess.on('exit', (code) => {
        console.log('[OllamaManager] Process exited with code:', code);
        ollamaProcess = null;
      });

      // Wait for server to be ready (up to 30 seconds)
      for (let i = 0; i < 60; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (await this.isRunning()) {
          console.log('[OllamaManager] Server started successfully');
          return;
        }
      }

      throw new Error('Ollama server did not start within 30 seconds');
    },

    async stop(): Promise<void> {
      if (ollamaProcess) {
        console.log('[OllamaManager] Stopping Ollama server...');

        // Try graceful shutdown first
        ollamaProcess.kill('SIGTERM');

        // Wait a bit for graceful shutdown
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Force kill if still running
        if (ollamaProcess && !ollamaProcess.killed) {
          ollamaProcess.kill('SIGKILL');
        }

        ollamaProcess = null;
        console.log('[OllamaManager] Server stopped');
      }
    },

    async listLocalModels(): Promise<OllamaModel[]> {
      try {
        const response = await fetch(`${SERVER_URL}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          return [];
        }

        const data = (await response.json()) as {
          models?: Array<{ name: string; size: number; modified_at: string }>;
        };

        return (data.models || []).map((m) => ({
          name: m.name,
          size: m.size,
          modifiedAt: m.modified_at,
        }));
      } catch {
        return [];
      }
    },

    async pullModel(
      name: string,
      onProgress: (progress: DownloadProgress) => void
    ): Promise<void> {
      console.log('[OllamaManager] Pulling model:', name);

      // Ensure server is running
      if (!(await this.isRunning())) {
        await this.start();
      }

      const response = await fetch(`${SERVER_URL}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to pull model: ${text}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response body reader');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line) as {
              status?: string;
              completed?: number;
              total?: number;
            };

            if (data.total && data.completed !== undefined) {
              const percent = Math.round((data.completed / data.total) * 100);
              onProgress({
                phase: 'model',
                percent,
                bytesDownloaded: data.completed,
                totalBytes: data.total,
                modelName: name,
              });
            }
          } catch {
            // Ignore parse errors for status messages
          }
        }
      }

      console.log('[OllamaManager] Model pull complete:', name);
    },

    async deleteModel(name: string): Promise<void> {
      console.log('[OllamaManager] Deleting model:', name);

      const response = await fetch(`${SERVER_URL}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to delete model: ${text}`);
      }

      console.log('[OllamaManager] Model deleted:', name);
    },
  };
}

// Cleanup function to be called on app quit
export function cleanupOllamaProcess(): void {
  if (ollamaProcess) {
    console.log('[OllamaManager] Cleaning up Ollama process on app quit');
    ollamaProcess.kill('SIGTERM');
    ollamaProcess = null;
  }
}
