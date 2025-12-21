import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Mock Electron modules before importing the adapter
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
  },
  net: {
    fetch: vi.fn(),
  },
}));

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { createImageCache } from './index';
import { app, net } from 'electron';

// ============================================
// Test Helpers
// ============================================

function createMockDb() {
  const data = new Map<number, { email_id: number; loaded_at: string }>();

  return {
    exec: vi.fn(),
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT 1 FROM email_images_loaded')) {
        return {
          get: vi.fn((emailId: number) => data.has(emailId) ? { 1: 1 } : undefined),
        };
      }
      if (sql.includes('INSERT OR IGNORE INTO email_images_loaded')) {
        return {
          run: vi.fn((emailId: number) => {
            data.set(emailId, { email_id: emailId, loaded_at: new Date().toISOString() });
          }),
        };
      }
      if (sql.includes('DELETE FROM email_images_loaded WHERE email_id')) {
        return {
          run: vi.fn((emailId: number) => {
            data.delete(emailId);
          }),
        };
      }
      if (sql.includes('DELETE FROM email_images_loaded')) {
        return {
          run: vi.fn(() => {
            data.clear();
          }),
        };
      }
      return { get: vi.fn(), run: vi.fn() };
    }),
    _data: data, // For test assertions
  };
}

function createMockResponse(options: {
  ok?: boolean;
  status?: number;
  contentType?: string;
  contentLength?: string;
  body?: ArrayBuffer;
}) {
  const {
    ok = true,
    status = 200,
    contentType = 'image/png',
    contentLength,
    body = new ArrayBuffer(100),
  } = options;

  return {
    ok,
    status,
    headers: {
      get: vi.fn((name: string) => {
        if (name === 'content-type') return contentType;
        if (name === 'content-length') return contentLength;
        return null;
      }),
    },
    arrayBuffer: vi.fn().mockResolvedValue(body),
  };
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

// ============================================
// URL Validation Tests
// ============================================

describe('image cache - URL validation', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('rejects javascript: URLs', async () => {
    const mockFetch = vi.mocked(net.fetch);

    const result = await imageCache.cacheImages(123, ['javascript:alert(1)']);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rejects data: URLs', async () => {
    const mockFetch = vi.mocked(net.fetch);

    const result = await imageCache.cacheImages(123, ['data:image/png;base64,abc']);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rejects file: URLs', async () => {
    const mockFetch = vi.mocked(net.fetch);

    const result = await imageCache.cacheImages(123, ['file:///etc/passwd']);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('rejects ftp: URLs', async () => {
    const mockFetch = vi.mocked(net.fetch);

    const result = await imageCache.cacheImages(123, ['ftp://example.com/image.png']);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('accepts https: URLs', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({}) as any);

    await imageCache.cacheImages(123, ['https://example.com/image.png']);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/image.png',
      expect.any(Object)
    );
  });

  it('accepts http: URLs', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({}) as any);

    await imageCache.cacheImages(123, ['http://example.com/image.png']);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://example.com/image.png',
      expect.any(Object)
    );
  });

  it('rejects invalid URLs', async () => {
    const mockFetch = vi.mocked(net.fetch);

    const result = await imageCache.cacheImages(123, ['not-a-valid-url']);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('filters out invalid URLs from mixed array', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({}) as any);

    const urls = [
      'https://example.com/valid.png',
      'javascript:alert(1)',
      'https://example.com/another.jpg',
      'file:///etc/passwd',
    ];

    await imageCache.cacheImages(123, urls);

    // Only valid URLs should be fetched
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/valid.png', expect.any(Object));
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/another.jpg', expect.any(Object));
  });
});

// ============================================
// Content-Type Validation Tests
// ============================================

describe('image cache - content-type validation', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('accepts image/jpeg content type', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'image/jpeg' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/photo.jpg']);

    expect(result).toHaveLength(1);
  });

  it('accepts image/png content type', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'image/png' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/icon.png']);

    expect(result).toHaveLength(1);
  });

  it('accepts image/gif content type', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'image/gif' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/anim.gif']);

    expect(result).toHaveLength(1);
  });

  it('accepts image/webp content type', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'image/webp' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/modern.webp']);

    expect(result).toHaveLength(1);
  });

  it('accepts image/svg+xml content type', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'image/svg+xml' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/logo.svg']);

    expect(result).toHaveLength(1);
  });

  it('rejects text/html content type', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'text/html' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/fake.png']);

    expect(result).toEqual([]);
  });

  it('rejects application/javascript content type', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'application/javascript' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/malicious.png']);

    expect(result).toEqual([]);
  });

  it('rejects text/plain content type', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'text/plain' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/sneaky.png']);

    expect(result).toEqual([]);
  });

  it('handles content-type with charset parameter', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'image/png; charset=utf-8' }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/image.png']);

    expect(result).toHaveLength(1);
  });
});

// ============================================
// Size Limit Tests
// ============================================

describe('image cache - size limits', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('rejects images larger than 5MB via content-length header', async () => {
    const mockFetch = vi.mocked(net.fetch);
    const tooBig = (5 * 1024 * 1024 + 1).toString();
    mockFetch.mockResolvedValue(createMockResponse({ contentLength: tooBig }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/huge.png']);

    expect(result).toEqual([]);
  });

  it('rejects images larger than 5MB after download', async () => {
    const mockFetch = vi.mocked(net.fetch);
    const tooBigBuffer = new ArrayBuffer(5 * 1024 * 1024 + 1);
    mockFetch.mockResolvedValue(createMockResponse({
      body: tooBigBuffer,
      contentLength: undefined, // No content-length header
    }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/huge.png']);

    expect(result).toEqual([]);
  });

  it('accepts images exactly at 5MB limit', async () => {
    const mockFetch = vi.mocked(net.fetch);
    const exactLimit = new ArrayBuffer(5 * 1024 * 1024);
    mockFetch.mockResolvedValue(createMockResponse({
      body: exactLimit,
      contentLength: (5 * 1024 * 1024).toString(),
    }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/big.png']);

    expect(result).toHaveLength(1);
  });

  it('accepts small images', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({
      body: new ArrayBuffer(1024), // 1KB
    }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/small.png']);

    expect(result).toHaveLength(1);
  });
});

// ============================================
// HTTP Response Handling Tests
// ============================================

describe('image cache - HTTP response handling', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('handles 404 response', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ ok: false, status: 404 }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/missing.png']);

    expect(result).toEqual([]);
  });

  it('handles 500 response', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ ok: false, status: 500 }) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/error.png']);

    expect(result).toEqual([]);
  });

  it('handles network timeout (AbortError)', async () => {
    const mockFetch = vi.mocked(net.fetch);
    const abortError = new Error('Timeout');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    const result = await imageCache.cacheImages(123, ['https://slow.example.com/image.png']);

    expect(result).toEqual([]);
  });

  it('handles generic network errors', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockRejectedValue(new Error('Network failed'));

    const result = await imageCache.cacheImages(123, ['https://unreachable.example.com/image.png']);

    expect(result).toEqual([]);
  });
});

// ============================================
// File Naming and Storage Tests
// ============================================

describe('image cache - file naming and storage', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('creates email-specific cache directory', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({}) as any);
    (fs.existsSync as any).mockReturnValue(false);

    await imageCache.cacheImages(456, ['https://example.com/image.png']);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('456'),
      { recursive: true }
    );
  });

  it('hashes URL for filename to avoid path traversal', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({ contentType: 'image/png' }) as any);

    const maliciousUrl = 'https://example.com/../../../etc/passwd.png';
    const result = await imageCache.cacheImages(123, [maliciousUrl]);

    // Filename should be a hash, not the original path
    expect(result[0].localPath).toMatch(/^cached-image:\/\/email\/123\/[a-f0-9]+\.png$/);
    expect(result[0].localPath).not.toContain('..');
    expect(result[0].localPath).not.toContain('passwd');
  });

  it('uses correct extension based on content-type', async () => {
    const mockFetch = vi.mocked(net.fetch);

    // Test jpeg
    mockFetch.mockResolvedValueOnce(createMockResponse({ contentType: 'image/jpeg' }) as any);
    let result = await imageCache.cacheImages(123, ['https://example.com/photo']);
    expect(result[0].localPath).toMatch(/\.jpg$/);

    // Test png
    mockFetch.mockResolvedValueOnce(createMockResponse({ contentType: 'image/png' }) as any);
    result = await imageCache.cacheImages(123, ['https://example.com/icon']);
    expect(result[0].localPath).toMatch(/\.png$/);

    // Test gif
    mockFetch.mockResolvedValueOnce(createMockResponse({ contentType: 'image/gif' }) as any);
    result = await imageCache.cacheImages(123, ['https://example.com/animation']);
    expect(result[0].localPath).toMatch(/\.gif$/);
  });

  it('writes image data to disk', async () => {
    const mockFetch = vi.mocked(net.fetch);
    const imageData = new ArrayBuffer(500);
    mockFetch.mockResolvedValue(createMockResponse({ body: imageData }) as any);

    await imageCache.cacheImages(123, ['https://example.com/image.png']);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer)
    );
  });

  it('returns cached-image:// URL for cached image', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({}) as any);

    const result = await imageCache.cacheImages(123, ['https://example.com/image.png']);

    expect(result[0].localPath).toMatch(/^cached-image:\/\/email\/123\//);
    expect(result[0].url).toBe('https://example.com/image.png');
  });
});

// ============================================
// Database Tracking Tests
// ============================================

describe('image cache - database tracking', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('hasLoadedImages returns false for new email', async () => {
    const result = await imageCache.hasLoadedImages(123);
    expect(result).toBe(false);
  });

  it('hasLoadedImages returns true after markImagesLoaded', async () => {
    await imageCache.markImagesLoaded(123);
    const result = await imageCache.hasLoadedImages(123);
    expect(result).toBe(true);
  });

  it('clearCache removes database record', async () => {
    await imageCache.markImagesLoaded(123);
    expect(await imageCache.hasLoadedImages(123)).toBe(true);

    await imageCache.clearCache(123);

    expect(await imageCache.hasLoadedImages(123)).toBe(false);
  });

  it('clearAllCache removes all database records', async () => {
    await imageCache.markImagesLoaded(123);
    await imageCache.markImagesLoaded(456);

    await imageCache.clearAllCache();

    expect(await imageCache.hasLoadedImages(123)).toBe(false);
    expect(await imageCache.hasLoadedImages(456)).toBe(false);
  });
});

// ============================================
// Batch Processing Tests
// ============================================

describe('image cache - batch processing', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('handles empty URL array', async () => {
    const result = await imageCache.cacheImages(123, []);
    expect(result).toEqual([]);
  });

  it('caches multiple images', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch.mockResolvedValue(createMockResponse({}) as any);

    const urls = [
      'https://example.com/img1.png',
      'https://example.com/img2.png',
      'https://example.com/img3.png',
    ];

    const result = await imageCache.cacheImages(123, urls);

    expect(result).toHaveLength(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns only successfully cached images', async () => {
    const mockFetch = vi.mocked(net.fetch);
    mockFetch
      .mockResolvedValueOnce(createMockResponse({}) as any)
      .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 }) as any)
      .mockResolvedValueOnce(createMockResponse({}) as any);

    const urls = [
      'https://example.com/img1.png',
      'https://example.com/missing.png',
      'https://example.com/img3.png',
    ];

    const result = await imageCache.cacheImages(123, urls);

    expect(result).toHaveLength(2);
    expect(result[0].url).toBe('https://example.com/img1.png');
    expect(result[1].url).toBe('https://example.com/img3.png');
  });
});

// ============================================
// Cache Cleanup Tests
// ============================================

describe('image cache - cleanup', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('clearCache removes email cache directory', async () => {
    await imageCache.clearCache(123);

    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('123'),
      { recursive: true, force: true }
    );
  });

  it('clearCacheFiles removes files but not DB record', async () => {
    await imageCache.markImagesLoaded(123);

    await imageCache.clearCacheFiles(123);

    // Files removed
    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('123'),
      { recursive: true, force: true }
    );

    // DB record still exists
    expect(await imageCache.hasLoadedImages(123)).toBe(true);
  });

  it('clearAllCache removes entire cache directory and recreates it', async () => {
    await imageCache.clearAllCache();

    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true, force: true }
    );
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.any(String),
      { recursive: true }
    );
  });

  it('clearCache handles non-existent directory gracefully', async () => {
    (fs.existsSync as any).mockReturnValue(false);

    // Should not throw
    await expect(imageCache.clearCache(999)).resolves.not.toThrow();
  });
});

// ============================================
// getCachedImages Tests
// ============================================

describe('image cache - getCachedImages', () => {
  let mockDb: ReturnType<typeof createMockDb>;
  let imageCache: ReturnType<typeof createImageCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    (fs.existsSync as any).mockReturnValue(true);
    imageCache = createImageCache(() => mockDb);
  });

  it('returns empty array for non-existent cache directory', async () => {
    (fs.existsSync as any).mockReturnValue(false);

    const result = await imageCache.getCachedImages(123);

    expect(result).toEqual([]);
  });

  it('returns cached files with cached-image:// URLs', async () => {
    (fs.readdirSync as any).mockReturnValue(['abc123.png', 'def456.jpg']);

    const result = await imageCache.getCachedImages(123);

    expect(result).toHaveLength(2);
    expect(result[0].localPath).toBe('cached-image://email/123/abc123.png');
    expect(result[1].localPath).toBe('cached-image://email/123/def456.jpg');
  });
});
