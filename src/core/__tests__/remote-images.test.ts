import { describe, it, expect, vi } from 'vitest';
import {
  loadRemoteImages,
  hasLoadedRemoteImages,
  getRemoteImagesSetting,
  setRemoteImagesSetting,
  clearImageCache,
  clearAllImageCache,
} from '../usecases';
import type { Deps, CachedImage, ImageCache, RemoteImagesSetting } from '../ports';

// ============================================
// Test Helpers
// ============================================

const mockEmail = { id: 123, accountId: 1 } as any;

function createMockImageCache(overrides: Partial<ImageCache> = {}): ImageCache {
  return {
    cacheImages: vi.fn().mockResolvedValue([]),
    getCachedImages: vi.fn().mockResolvedValue([]),
    hasLoadedImages: vi.fn().mockResolvedValue(false),
    markImagesLoaded: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearCacheFiles: vi.fn().mockResolvedValue(undefined),
    clearAllCache: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockEmailRepo(overrides = {}) {
  return {
    findById: vi.fn().mockResolvedValue(mockEmail),
    ...overrides,
  };
}

function createMockConfig(overrides: Partial<Deps['config']> = {}) {
  return {
    getLLMConfig: () => ({} as any),
    getRemoteImagesSetting: vi.fn().mockReturnValue('block' as RemoteImagesSetting),
    setRemoteImagesSetting: vi.fn(),
    ...overrides,
  };
}

// ============================================
// loadRemoteImages Use Case Tests
// ============================================

describe('loadRemoteImages', () => {
  const testUrls = [
    'https://example.com/image1.png',
    'https://example.com/image2.jpg',
  ];

  const cachedImages: CachedImage[] = [
    { url: 'https://example.com/image1.png', localPath: 'file:///cache/1/abc123.png' },
    { url: 'https://example.com/image2.jpg', localPath: 'file:///cache/1/def456.jpg' },
  ];

  it('throws error when email not found', async () => {
    const deps = {
      emails: createMockEmailRepo({ findById: vi.fn().mockResolvedValue(null) }),
      imageCache: createMockImageCache(),
    };

    await expect(loadRemoteImages(deps)(999, testUrls)).rejects.toThrow('Email not found');
  });

  it('returns cached images when already loaded', async () => {
    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockResolvedValue(true),
      getCachedImages: vi.fn().mockResolvedValue(cachedImages),
    });

    const deps = {
      emails: createMockEmailRepo(),
      imageCache,
    };

    const result = await loadRemoteImages(deps)(123, testUrls);

    expect(result).toEqual(cachedImages);
    expect(imageCache.cacheImages).not.toHaveBeenCalled();
    expect(imageCache.markImagesLoaded).not.toHaveBeenCalled();
  });

  it('fetches and caches images when not already loaded', async () => {
    const cacheImagesSpy = vi.fn().mockResolvedValue(cachedImages);
    const markLoadedSpy = vi.fn().mockResolvedValue(undefined);

    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockResolvedValue(false),
      cacheImages: cacheImagesSpy,
      markImagesLoaded: markLoadedSpy,
    });

    const deps = {
      emails: createMockEmailRepo(),
      imageCache,
    };

    const result = await loadRemoteImages(deps)(123, testUrls);

    expect(cacheImagesSpy).toHaveBeenCalledWith(123, testUrls);
    expect(markLoadedSpy).toHaveBeenCalledWith(123);
    expect(result).toEqual(cachedImages);
  });

  it('marks images as loaded after caching', async () => {
    const markLoadedSpy = vi.fn().mockResolvedValue(undefined);
    const cacheImagesSpy = vi.fn().mockResolvedValue(cachedImages);

    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockResolvedValue(false),
      cacheImages: cacheImagesSpy,
      markImagesLoaded: markLoadedSpy,
    });

    const deps = {
      emails: createMockEmailRepo(),
      imageCache,
    };

    await loadRemoteImages(deps)(123, testUrls);

    // Verify order: cacheImages should be called before markImagesLoaded
    const cacheCall = cacheImagesSpy.mock.invocationCallOrder[0];
    const markCall = markLoadedSpy.mock.invocationCallOrder[0];
    expect(cacheCall).toBeLessThan(markCall);
  });

  it('handles empty URL array', async () => {
    const cacheImagesSpy = vi.fn().mockResolvedValue([]);

    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockResolvedValue(false),
      cacheImages: cacheImagesSpy,
    });

    const deps = {
      emails: createMockEmailRepo(),
      imageCache,
    };

    const result = await loadRemoteImages(deps)(123, []);

    expect(cacheImagesSpy).toHaveBeenCalledWith(123, []);
    expect(result).toEqual([]);
  });
});

// ============================================
// hasLoadedRemoteImages Use Case Tests
// ============================================

describe('hasLoadedRemoteImages', () => {
  it('returns true when images have been loaded', async () => {
    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockResolvedValue(true),
    });

    const result = await hasLoadedRemoteImages({ imageCache })(123);
    expect(result).toBe(true);
    expect(imageCache.hasLoadedImages).toHaveBeenCalledWith(123);
  });

  it('returns false when images have not been loaded', async () => {
    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockResolvedValue(false),
    });

    const result = await hasLoadedRemoteImages({ imageCache })(456);
    expect(result).toBe(false);
    expect(imageCache.hasLoadedImages).toHaveBeenCalledWith(456);
  });
});

// ============================================
// getRemoteImagesSetting Use Case Tests
// ============================================

describe('getRemoteImagesSetting', () => {
  it('returns block when setting is block', () => {
    const config = createMockConfig({
      getRemoteImagesSetting: vi.fn().mockReturnValue('block'),
    });

    const result = getRemoteImagesSetting({ config })();
    expect(result).toBe('block');
  });

  it('returns allow when setting is allow', () => {
    const config = createMockConfig({
      getRemoteImagesSetting: vi.fn().mockReturnValue('allow'),
    });

    const result = getRemoteImagesSetting({ config })();
    expect(result).toBe('allow');
  });

  it('returns auto when setting is auto', () => {
    const config = createMockConfig({
      getRemoteImagesSetting: vi.fn().mockReturnValue('auto'),
    });

    const result = getRemoteImagesSetting({ config })();
    expect(result).toBe('auto');
  });
});

// ============================================
// setRemoteImagesSetting Use Case Tests
// ============================================

describe('setRemoteImagesSetting', () => {
  it('calls config.setRemoteImagesSetting with block', () => {
    const setSettingSpy = vi.fn();
    const config = createMockConfig({
      setRemoteImagesSetting: setSettingSpy,
    });

    setRemoteImagesSetting({ config })('block');
    expect(setSettingSpy).toHaveBeenCalledWith('block');
  });

  it('calls config.setRemoteImagesSetting with allow', () => {
    const setSettingSpy = vi.fn();
    const config = createMockConfig({
      setRemoteImagesSetting: setSettingSpy,
    });

    setRemoteImagesSetting({ config })('allow');
    expect(setSettingSpy).toHaveBeenCalledWith('allow');
  });

  it('calls config.setRemoteImagesSetting with auto', () => {
    const setSettingSpy = vi.fn();
    const config = createMockConfig({
      setRemoteImagesSetting: setSettingSpy,
    });

    setRemoteImagesSetting({ config })('auto');
    expect(setSettingSpy).toHaveBeenCalledWith('auto');
  });
});

// ============================================
// clearImageCache Use Case Tests
// ============================================

describe('clearImageCache', () => {
  it('calls imageCache.clearCache with email ID', async () => {
    const clearCacheSpy = vi.fn().mockResolvedValue(undefined);
    const imageCache = createMockImageCache({
      clearCache: clearCacheSpy,
    });

    await clearImageCache({ imageCache })(123);

    expect(clearCacheSpy).toHaveBeenCalledWith(123);
  });
});

// ============================================
// clearAllImageCache Use Case Tests
// ============================================

describe('clearAllImageCache', () => {
  it('calls imageCache.clearAllCache', async () => {
    const clearAllSpy = vi.fn().mockResolvedValue(undefined);
    const imageCache = createMockImageCache({
      clearAllCache: clearAllSpy,
    });

    await clearAllImageCache({ imageCache })();

    expect(clearAllSpy).toHaveBeenCalled();
  });
});

// ============================================
// Integration-style Tests: Settings + Loading
// ============================================

describe('remote images workflow', () => {
  it('respects user choice to load images for specific email', async () => {
    let imagesLoaded = false;
    const cachedImages: CachedImage[] = [
      { url: 'https://newsletter.com/logo.png', localPath: 'file:///cache/123/logo.png' },
    ];

    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockImplementation(() => Promise.resolve(imagesLoaded)),
      cacheImages: vi.fn().mockImplementation(() => {
        imagesLoaded = true;
        return Promise.resolve(cachedImages);
      }),
      getCachedImages: vi.fn().mockResolvedValue(cachedImages),
      markImagesLoaded: vi.fn().mockResolvedValue(undefined),
    });

    const deps = {
      emails: createMockEmailRepo(),
      imageCache,
    };

    // First call: should fetch and cache
    const firstResult = await loadRemoteImages(deps)(123, ['https://newsletter.com/logo.png']);
    expect(firstResult).toEqual(cachedImages);
    expect(imageCache.cacheImages).toHaveBeenCalledTimes(1);

    // Second call: should return cached (already loaded)
    const secondResult = await loadRemoteImages(deps)(123, ['https://newsletter.com/logo.png']);
    expect(secondResult).toEqual(cachedImages);
    // cacheImages should NOT be called again
    expect(imageCache.cacheImages).toHaveBeenCalledTimes(1);
  });

  it('allows loading after clearing cache', async () => {
    let imagesLoaded = true;
    const cachedImages: CachedImage[] = [
      { url: 'https://example.com/img.png', localPath: 'file:///cache/123/img.png' },
    ];

    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockImplementation(() => Promise.resolve(imagesLoaded)),
      cacheImages: vi.fn().mockResolvedValue(cachedImages),
      getCachedImages: vi.fn().mockResolvedValue(cachedImages),
      clearCache: vi.fn().mockImplementation(() => {
        imagesLoaded = false;
        return Promise.resolve();
      }),
      markImagesLoaded: vi.fn().mockImplementation(() => {
        imagesLoaded = true;
        return Promise.resolve();
      }),
    });

    const deps = {
      emails: createMockEmailRepo(),
      imageCache,
    };

    // Initially loaded - should return cached
    let result = await loadRemoteImages(deps)(123, ['https://example.com/img.png']);
    expect(result).toEqual(cachedImages);
    expect(imageCache.cacheImages).not.toHaveBeenCalled();

    // Clear cache
    await clearImageCache({ imageCache })(123);

    // Now should fetch again
    result = await loadRemoteImages(deps)(123, ['https://example.com/img.png']);
    expect(imageCache.cacheImages).toHaveBeenCalledTimes(1);
  });
});

// ============================================
// Security Edge Cases
// ============================================

describe('security considerations', () => {
  it('passes URLs to imageCache which handles validation', async () => {
    // Note: URL validation happens in the adapter, not the use case
    // The use case trusts the adapter to reject invalid URLs
    const cacheImagesSpy = vi.fn().mockResolvedValue([]);

    const imageCache = createMockImageCache({
      hasLoadedImages: vi.fn().mockResolvedValue(false),
      cacheImages: cacheImagesSpy,
    });

    const deps = {
      emails: createMockEmailRepo(),
      imageCache,
    };

    const mixedUrls = [
      'https://valid.com/image.png',
      'javascript:alert(1)', // Adapter should reject
      'file:///etc/passwd',  // Adapter should reject
      'data:image/png;base64,...', // Adapter should reject
    ];

    await loadRemoteImages(deps)(123, mixedUrls);

    // Use case passes all URLs to adapter; adapter handles validation
    expect(cacheImagesSpy).toHaveBeenCalledWith(123, mixedUrls);
  });
});
