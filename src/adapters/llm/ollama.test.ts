import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOllamaProvider, createOllamaClassifier, startOllama, resetOllamaEmailCount } from './ollama';
import type { Tag } from '../../core/domain';

// Mock global fetch
global.fetch = vi.fn();

// Mock child_process - needs to be hoisted
const mockSpawn = vi.fn();
vi.mock('child_process', async () => {
  return {
    spawn: mockSpawn,
  };
});

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('testConnection', () => {
    it('returns connected: true when server responds with models', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.2' }] }),
      });

      const provider = createOllamaProvider();
      const result = await provider.testConnection!();

      expect(result.connected).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns connected: true with warning when server responds but has no models', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const provider = createOllamaProvider();
      const result = await provider.testConnection!();

      expect(result.connected).toBe(true);
      expect(result.error).toContain('No models installed');
      expect(result.error).toContain('ollama pull');
    });

    it('returns user-friendly error when connection is refused (Ollama not running)', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('fetch failed'));

      const provider = createOllamaProvider();
      const result = await provider.testConnection!();

      expect(result.connected).toBe(false);
      expect(result.error).toContain('Ollama is not running');
      expect(result.error).toContain('ollama serve');
    });

    it('returns user-friendly error when connection times out', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));

      const provider = createOllamaProvider();
      const result = await provider.testConnection!();

      expect(result.connected).toBe(false);
      expect(result.error).toContain('timed out');
      expect(result.error).toContain('Is Ollama running');
    });

    it('returns error when server returns non-200 status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const provider = createOllamaProvider();
      const result = await provider.testConnection!();

      expect(result.connected).toBe(false);
      expect(result.error).toContain('500');
    });
  });

  describe('listModels', () => {
    it('returns empty array when server is not reachable', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('fetch failed'));

      const provider = createOllamaProvider();
      const models = await provider.listModels();

      expect(models).toEqual([]);
    });

    it('returns models when server responds', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'llama3.2', modified_at: '2024-01-01' },
            { name: 'mistral:7b', modified_at: '2024-01-02' },
          ],
        }),
      });

      const provider = createOllamaProvider();
      const models = await provider.listModels();

      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({
        id: 'llama3.2',
        displayName: 'llama3.2',
        createdAt: '2024-01-01',
      });
    });
  });

  describe('validateKey', () => {
    it('validates by testing connection (Ollama has no API key)', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3.2' }] }),
      });

      const provider = createOllamaProvider();
      const result = await provider.validateKey();

      expect(result.valid).toBe(true);
    });

    it('returns invalid when server is not reachable', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('fetch failed'));

      const provider = createOllamaProvider();
      const result = await provider.validateKey();

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe('OllamaClassifier', () => {
  const mockTags: Tag[] = [
    { id: 1, slug: 'work', name: 'Work', color: '#blue', isSystem: false, sortOrder: 0, createdAt: new Date() },
    { id: 2, slug: 'personal', name: 'Personal', color: '#green', isSystem: false, sortOrder: 1, createdAt: new Date() },
  ];

  const mockTagRepo = {
    findAll: vi.fn().mockResolvedValue(mockTags),
  };

  const mockEmail = {
    id: 1,
    subject: 'Test Email',
    from: { address: 'test@example.com', name: 'Test User' },
    to: [{ address: 'me@example.com', name: 'Me' }],
    date: new Date('2024-01-01'),
    snippet: 'This is a test email',
    isRead: false,
    isStarred: false,
    accountId: 1,
    folderPath: 'INBOX',
    threadId: null,
    uid: 1,
    messageId: '<test@example.com>',
    inReplyTo: null,
    references: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetOllamaEmailCount(); // Reset counter between tests
  });

  describe('classify', () => {
    it('throws user-friendly error when Ollama server is not running', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('fetch failed'));

      const config = {
        model: 'llama3.2',
        serverUrl: 'http://localhost:11434',
        dailyBudget: 100000,
        dailyEmailLimit: 200,
      };

      const classifier = createOllamaClassifier(config, mockTagRepo);

      await expect(classifier.classify(mockEmail, undefined, [])).rejects.toThrow('Ollama server is not running');
    });

    it('throws user-friendly error when server returns error status', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const config = {
        model: 'llama3.2',
        serverUrl: 'http://localhost:11434',
        dailyBudget: 100000,
        dailyEmailLimit: 200,
      };

      const classifier = createOllamaClassifier(config, mockTagRepo);

      await expect(classifier.classify(mockEmail, undefined, [])).rejects.toThrow('503');
    });

    it('returns classification when server responds with valid JSON', async () => {
      const mockResponse = {
        tags: ['work'],
        confidence: 0.9,
        reasoning: 'Email is work-related',
        priority: 'high',
        newTag: null,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify(mockResponse) },
        }),
      });

      const config = {
        model: 'llama3.2',
        serverUrl: 'http://localhost:11434',
        dailyBudget: 100000,
        dailyEmailLimit: 200,
      };

      const classifier = createOllamaClassifier(config, mockTagRepo);
      const result = await classifier.classify(mockEmail, undefined, []);

      expect(result.suggestedTags).toEqual(['work']);
      expect(result.confidence).toBe(0.9);
      expect(result.reasoning).toBe('Email is work-related');
    });

    it('returns empty classification when LLM response is not valid JSON', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'This is not JSON' },
        }),
      });

      const config = {
        model: 'llama3.2',
        serverUrl: 'http://localhost:11434',
        dailyBudget: 100000,
        dailyEmailLimit: 200,
      };

      const classifier = createOllamaClassifier(config, mockTagRepo);
      const result = await classifier.classify(mockEmail, undefined, []);

      expect(result.suggestedTags).toEqual([]);
      expect(result.confidence).toBe(0);
      expect(result.reasoning).toBe('Parse error');
    });

    it('respects daily email limit', async () => {
      const config = {
        model: 'llama3.2',
        serverUrl: 'http://localhost:11434',
        dailyBudget: 100000,
        dailyEmailLimit: 1,
      };

      const classifier = createOllamaClassifier(config, mockTagRepo);

      // First classification should work
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify({ tags: [], confidence: 0.5, reasoning: 'test' }) },
        }),
      });

      await classifier.classify(mockEmail, undefined, []);

      // Second should fail with budget error
      await expect(classifier.classify(mockEmail, undefined, [])).rejects.toThrow('Daily budget exceeded');
    });
  });
});

describe('startOllama', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns started: true if Ollama is already running', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    const result = await startOllama();

    expect(result.started).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockSpawn).not.toHaveBeenCalled(); // Should not try to spawn
  });

  it('returns user-friendly error when Ollama is not installed (ENOENT)', async () => {
    // First check fails (not running)
    (global.fetch as any).mockRejectedValue(new Error('fetch failed'));

    // Mock spawn throwing ENOENT
    const err = new Error('spawn ollama ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockSpawn.mockImplementationOnce(() => {
      throw err;
    });

    const result = await startOllama();

    expect(result.started).toBe(false);
    expect(result.error).toContain('Ollama is not installed');
    expect(result.error).toContain('https://ollama.ai');
  });

  it('attempts to start Ollama when not running', async () => {
    // First check fails (not running)
    (global.fetch as any).mockRejectedValueOnce(new Error('fetch failed'));

    // Mock successful spawn
    const mockChild = {
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValueOnce(mockChild);

    // Mock polling: fail a few times, then succeed
    (global.fetch as any)
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      });

    const result = await startOllama();

    expect(result.started).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
    });
    expect(mockChild.unref).toHaveBeenCalled();
  });

  it('returns timeout error if Ollama does not start within 10 seconds', async () => {
    // First check fails (not running)
    (global.fetch as any).mockRejectedValue(new Error('fetch failed'));

    // Mock successful spawn
    const mockChild = {
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValueOnce(mockChild);

    // All polling attempts fail (needs 20+ calls since we poll 20 times)
    const result = await startOllama();

    expect(result.started).toBe(false);
    expect(result.error).toContain('did not start within 10 seconds');
  }, 15000); // Increase test timeout since this test waits 10+ seconds
});
