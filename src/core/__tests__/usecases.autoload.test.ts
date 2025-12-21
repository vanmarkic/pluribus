import { describe, it, expect, vi } from 'vitest';
import { autoLoadImagesForEmail } from '../usecases';
import type { Deps } from '../ports';

describe('autoLoadImagesForEmail', () => {
  const mockCachedImages = [
    { url: 'https://example.com/img.png', localPath: 'file:///cache/img.png' },
  ];

  const createMockDeps = (overrides: Partial<Deps> = {}) => ({
    config: {
      getRemoteImagesSetting: () => 'auto' as const,
      getLLMConfig: () => ({} as any),
      setRemoteImagesSetting: () => {},
    },
    imageCache: {
      hasLoadedImages: async () => false,
      getCachedImages: async () => mockCachedImages,
      cacheImages: async () => mockCachedImages,
      markImagesLoaded: async () => {},
      clearCache: async () => {},
      clearAllCache: async () => {},
    },
    ...overrides,
  }) as unknown as Pick<Deps, 'config' | 'imageCache'>;

  it('returns empty array when setting is block', async () => {
    const deps = createMockDeps({
      config: {
        getRemoteImagesSetting: () => 'block' as const,
        getLLMConfig: () => ({} as any),
        setRemoteImagesSetting: () => {},
      },
    });

    const result = await autoLoadImagesForEmail(deps)(123, ['https://example.com/img.png']);
    expect(result).toEqual([]);
  });

  it('returns cached images when already loaded', async () => {
    const deps = createMockDeps({
      imageCache: {
        hasLoadedImages: async () => true,
        getCachedImages: async () => mockCachedImages,
        cacheImages: async () => mockCachedImages,
        markImagesLoaded: async () => {},
        clearCache: async () => {},
        clearAllCache: async () => {},
        clearCacheFiles: async () => {},
      },
    });

    const result = await autoLoadImagesForEmail(deps)(123, ['https://example.com/img.png']);
    expect(result).toEqual(mockCachedImages);
  });

  it('fetches and caches images when not loaded and setting is auto', async () => {
    const cacheImagesSpy = vi.fn().mockResolvedValue(mockCachedImages);
    const markLoadedSpy = vi.fn().mockResolvedValue(undefined);

    const deps = createMockDeps({
      imageCache: {
        hasLoadedImages: async () => false,
        getCachedImages: async () => [],
        cacheImages: cacheImagesSpy,
        markImagesLoaded: markLoadedSpy,
        clearCache: async () => {},
        clearAllCache: async () => {},
        clearCacheFiles: async () => {},
      },
    });

    const urls = ['https://example.com/img.png'];
    const result = await autoLoadImagesForEmail(deps)(123, urls);

    expect(cacheImagesSpy).toHaveBeenCalledWith(123, urls);
    expect(markLoadedSpy).toHaveBeenCalledWith(123);
    expect(result).toEqual(mockCachedImages);
  });

  it('fetches and caches images when not loaded and setting is allow', async () => {
    const cacheImagesSpy = vi.fn().mockResolvedValue(mockCachedImages);
    const markLoadedSpy = vi.fn().mockResolvedValue(undefined);

    const deps = createMockDeps({
      config: {
        getRemoteImagesSetting: () => 'allow' as const,
        getLLMConfig: () => ({} as any),
        setRemoteImagesSetting: () => {},
      },
      imageCache: {
        hasLoadedImages: async () => false,
        getCachedImages: async () => [],
        cacheImages: cacheImagesSpy,
        markImagesLoaded: markLoadedSpy,
        clearCache: async () => {},
        clearAllCache: async () => {},
        clearCacheFiles: async () => {},
      },
    });

    const urls = ['https://example.com/img.png'];
    const result = await autoLoadImagesForEmail(deps)(123, urls);

    expect(cacheImagesSpy).toHaveBeenCalledWith(123, urls);
    expect(markLoadedSpy).toHaveBeenCalledWith(123);
    expect(result).toEqual(mockCachedImages);
  });

  it('returns empty array when no blocked URLs provided', async () => {
    const cacheImagesSpy = vi.fn().mockResolvedValue([]);

    const deps = createMockDeps({
      imageCache: {
        hasLoadedImages: async () => false,
        getCachedImages: async () => [],
        cacheImages: cacheImagesSpy,
        markImagesLoaded: async () => {},
        clearCache: async () => {},
        clearAllCache: async () => {},
        clearCacheFiles: async () => {},
      },
    });

    const result = await autoLoadImagesForEmail(deps)(123, []);

    expect(cacheImagesSpy).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
