/**
 * OllamaManager Tests
 *
 * Tests for path generation, installation check, and response parsing.
 * Network operations are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron app before imports
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user/data'),
  },
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    mkdir: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs (for createWriteStream)
vi.mock('fs', () => ({
  createWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn((event, cb) => {
      if (event === 'finish') setTimeout(cb, 0);
    }),
  })),
}));

import fs from 'fs/promises';
import { createOllamaManager, RECOMMENDED_MODELS, cleanupOllamaProcess } from './index';

describe('OllamaManager', () => {
  let manager: ReturnType<typeof createOllamaManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createOllamaManager();
  });

  describe('Path generation', () => {
    it('returns correct ollama binary path', () => {
      expect(manager.getOllamaPath()).toBe('/mock/user/data/ollama/bin/ollama');
    });

    it('returns correct models path', () => {
      expect(manager.getModelsPath()).toBe('/mock/user/data/ollama/models');
    });

    it('returns correct server URL with custom port', () => {
      expect(manager.getServerUrl()).toBe('http://127.0.0.1:11435');
    });
  });

  describe('isInstalled', () => {
    it('returns true when binary exists and is executable', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        mode: 0o755,
      } as any);

      const result = await manager.isInstalled();
      expect(result).toBe(true);
    });

    it('returns false when binary does not exist', async () => {
      vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

      const result = await manager.isInstalled();
      expect(result).toBe(false);
    });

    it('returns false when binary is not executable', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        mode: 0o644, // No execute bit
      } as any);

      const result = await manager.isInstalled();
      expect(result).toBe(false);
    });

    it('returns false when path is a directory', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => false,
        mode: 0o755,
      } as any);

      const result = await manager.isInstalled();
      expect(result).toBe(false);
    });
  });

  describe('isRunning', () => {
    it('returns true when server responds', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      const result = await manager.isRunning();
      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:11435/api/tags',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('returns false when server does not respond', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await manager.isRunning();
      expect(result).toBe(false);
    });

    it('returns false when server returns error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await manager.isRunning();
      expect(result).toBe(false);
    });
  });

  describe('listLocalModels', () => {
    it('parses model list from API response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'mistral:7b', size: 4100000000, modified_at: '2024-01-01T00:00:00Z' },
            { name: 'llama3.2:3b', size: 2000000000, modified_at: '2024-01-02T00:00:00Z' },
          ],
        }),
      });

      const models = await manager.listLocalModels();

      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({
        name: 'mistral:7b',
        size: 4100000000,
        modifiedAt: '2024-01-01T00:00:00Z',
      });
      expect(models[1]).toEqual({
        name: 'llama3.2:3b',
        size: 2000000000,
        modifiedAt: '2024-01-02T00:00:00Z',
      });
    });

    it('returns empty array when server not running', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const models = await manager.listLocalModels();
      expect(models).toEqual([]);
    });

    it('returns empty array when no models installed', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const models = await manager.listLocalModels();
      expect(models).toEqual([]);
    });

    it('handles missing models field gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const models = await manager.listLocalModels();
      expect(models).toEqual([]);
    });
  });

  describe('RECOMMENDED_MODELS', () => {
    it('has 3 curated models', () => {
      expect(RECOMMENDED_MODELS).toHaveLength(3);
    });

    it('includes Llama 3.2', () => {
      const llama = RECOMMENDED_MODELS.find((m) => m.id === 'llama3.2:3b');
      expect(llama).toBeDefined();
      expect(llama?.name).toBe('Llama 3.2');
    });

    it('includes Mistral for European languages', () => {
      const mistral = RECOMMENDED_MODELS.find((m) => m.id === 'mistral:7b');
      expect(mistral).toBeDefined();
      expect(mistral?.description).toContain('French');
    });

    it('includes Phi-3 Mini for older machines', () => {
      const phi = RECOMMENDED_MODELS.find((m) => m.id === 'phi3:mini');
      expect(phi).toBeDefined();
      expect(phi?.description).toContain('older machines');
    });

    it('all models have required fields', () => {
      for (const model of RECOMMENDED_MODELS) {
        expect(model.id).toBeTruthy();
        expect(model.name).toBeTruthy();
        expect(model.description).toBeTruthy();
        expect(model.size).toBeTruthy();
        expect(model.sizeBytes).toBeGreaterThan(0);
      }
    });
  });

  describe('deleteModel', () => {
    it('calls API with correct model name', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      await manager.deleteModel('mistral:7b');

      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:11435/api/delete',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ name: 'mistral:7b' }),
        })
      );
    });

    it('throws error when API fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        text: async () => 'Model not found',
      });

      await expect(manager.deleteModel('nonexistent')).rejects.toThrow(
        'Failed to delete model'
      );
    });
  });
});
