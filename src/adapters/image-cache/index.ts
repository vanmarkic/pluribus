/**
 * Image Cache Adapter
 *
 * Caches remote email images to local filesystem.
 * Storage: {userData}/cache/images/{emailId}/{hash}.{ext}
 * Security: Only fetches http/https URLs, validates content-type
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app, net } from 'electron';
import type { ImageCache, CachedImage } from '../../core/ports';

// Allowed image content types
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

// Extension mapping for content types
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

// Max image size (5MB)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

// Timeout for fetching images (10 seconds)
const FETCH_TIMEOUT_MS = 10000;

/**
 * Get the base cache directory
 */
function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'cache', 'images');
}

/**
 * Get the cache directory for a specific email
 */
function getEmailCacheDir(emailId: number): string {
  return path.join(getCacheDir(), String(emailId));
}

/**
 * Hash a URL to create a unique filename
 */
function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Validate URL is safe to fetch
 */
function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Get extension from content-type or URL
 */
function getExtension(contentType: string | null, url: string): string {
  if (contentType && CONTENT_TYPE_EXTENSIONS[contentType]) {
    return CONTENT_TYPE_EXTENSIONS[contentType];
  }

  // Try to extract from URL
  const urlPath = new URL(url).pathname;
  const ext = path.extname(urlPath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }

  return '.bin'; // Fallback
}

/**
 * Fetch a single image with timeout and size limits
 */
async function fetchImage(url: string): Promise<{ data: Buffer; contentType: string | null } | null> {
  if (!isValidImageUrl(url)) {
    console.warn(`Invalid image URL: ${url}`);
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await net.fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`Failed to fetch image ${url}: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type')?.split(';')[0].trim() || null;

    // Validate content type
    if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      console.warn(`Invalid content type for image ${url}: ${contentType}`);
      return null;
    }

    // Check content length if available
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
      console.warn(`Image too large: ${url} (${contentLength} bytes)`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);

    // Verify size after download
    if (data.length > MAX_IMAGE_SIZE) {
      console.warn(`Image too large after download: ${url} (${data.length} bytes)`);
      return null;
    }

    return { data, contentType };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`Timeout fetching image: ${url}`);
    } else {
      console.warn(`Error fetching image ${url}:`, err);
    }
    return null;
  }
}

/**
 * Create the image cache adapter
 *
 * @param getDb - Function to get the SQLite database instance
 */
export function createImageCache(getDb: () => any): ImageCache {
  // Ensure cache directory exists
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Ensure tracking table exists
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS email_images_loaded (
      email_id INTEGER PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
      loaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return {
    async cacheImages(emailId: number, urls: string[]): Promise<CachedImage[]> {
      const emailCacheDir = getEmailCacheDir(emailId);

      // Create directory for this email
      if (!fs.existsSync(emailCacheDir)) {
        fs.mkdirSync(emailCacheDir, { recursive: true });
      }

      const results: CachedImage[] = [];

      // Fetch all images concurrently (with limit)
      const batchSize = 5;
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        const fetches = batch.map(async (url) => {
          const hash = hashUrl(url);
          const result = await fetchImage(url);

          if (!result) {
            return null;
          }

          const ext = getExtension(result.contentType, url);
          const filename = `${hash}${ext}`;
          const localFilePath = path.join(emailCacheDir, filename);

          // Write to disk
          fs.writeFileSync(localFilePath, result.data);

          // Return file:// URL for use in renderer
          return {
            url,
            localPath: `file://${localFilePath}`,
          };
        });

        const batchResults = await Promise.all(fetches);
        results.push(...batchResults.filter((r): r is CachedImage => r !== null));
      }

      return results;
    },

    async getCachedImages(emailId: number): Promise<CachedImage[]> {
      const emailCacheDir = getEmailCacheDir(emailId);

      if (!fs.existsSync(emailCacheDir)) {
        return [];
      }

      // We don't store URL->file mapping, so we can only return local paths
      // The renderer should use the original URLs it stored
      const files = fs.readdirSync(emailCacheDir);
      return files.map((filename) => ({
        url: '', // Original URL not stored - renderer must track this
        localPath: `file://${path.join(emailCacheDir, filename)}`,
      }));
    },

    async hasLoadedImages(emailId: number): Promise<boolean> {
      const row = getDb()
        .prepare('SELECT 1 FROM email_images_loaded WHERE email_id = ?')
        .get(emailId);
      return row !== undefined;
    },

    async markImagesLoaded(emailId: number): Promise<void> {
      getDb()
        .prepare('INSERT OR IGNORE INTO email_images_loaded (email_id) VALUES (?)')
        .run(emailId);
    },

    async clearCache(emailId: number): Promise<void> {
      const emailCacheDir = getEmailCacheDir(emailId);

      // Remove from tracking table
      getDb()
        .prepare('DELETE FROM email_images_loaded WHERE email_id = ?')
        .run(emailId);

      // Remove files
      if (fs.existsSync(emailCacheDir)) {
        fs.rmSync(emailCacheDir, { recursive: true, force: true });
      }
    },

    async clearCacheFiles(emailId: number): Promise<void> {
      const emailCacheDir = getEmailCacheDir(emailId);

      // Only remove files, NOT the DB tracking record
      // (CASCADE will handle the DB record when email is deleted)
      if (fs.existsSync(emailCacheDir)) {
        fs.rmSync(emailCacheDir, { recursive: true, force: true });
      }
    },

    async clearAllCache(): Promise<void> {
      // Remove all tracking entries
      getDb().prepare('DELETE FROM email_images_loaded').run();

      // Remove entire cache directory
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        // Recreate empty cache directory
        fs.mkdirSync(cacheDir, { recursive: true });
      }
    },
  };
}
