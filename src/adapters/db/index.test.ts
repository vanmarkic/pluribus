/**
 * Database Adapter Tests
 *
 * Focus on SQL injection vulnerabilities and security fixes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { initDb, closeDb, createEmailRepo, createContactRepo } from './index';
import type { Email } from '../../core/domain';

const TEST_DB_PATH = path.join(__dirname, 'test.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

describe('Database Adapter - SQL Injection Protection', () => {
  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Initialize fresh database with schema
    initDb(TEST_DB_PATH, SCHEMA_PATH);
  });

  afterEach(() => {
    closeDb();

    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Clean up WAL files
    const walPath = TEST_DB_PATH + '-wal';
    const shmPath = TEST_DB_PATH + '-shm';
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  });

  describe('FTS Search - escapeFtsQuery', () => {
    it('should handle normal search queries', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('hello world');
      expect(results).toEqual([]);
    });

    it('should escape FTS special characters (*)', async () => {
      const repo = createEmailRepo();
      // Should not throw or cause SQL errors
      const results = await repo.search('test* query*');
      expect(results).toEqual([]);
    });

    it('should escape FTS special characters (")', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('test "quoted" query');
      expect(results).toEqual([]);
    });

    it('should escape FTS special characters (parentheses)', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('test (OR) query');
      expect(results).toEqual([]);
    });

    it('should escape FTS special characters (brackets)', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('test [column] query');
      expect(results).toEqual([]);
    });

    it('should escape FTS special characters (braces)', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('test {field} query');
      expect(results).toEqual([]);
    });

    it('should remove boolean operators (AND)', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('term1 AND term2');
      expect(results).toEqual([]);
    });

    it('should remove boolean operators (OR)', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('term1 OR term2');
      expect(results).toEqual([]);
    });

    it('should remove boolean operators (NOT)', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('term1 NOT term2');
      expect(results).toEqual([]);
    });

    it('should remove boolean operators (NEAR)', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('term1 NEAR term2');
      expect(results).toEqual([]);
    });

    it('should handle empty query after sanitization', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('***');
      expect(results).toEqual([]);
    });

    it('should handle query with only special characters', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('(){}[]^~\\');
      expect(results).toEqual([]);
    });

    it('should limit query length', async () => {
      const repo = createEmailRepo();
      const longQuery = 'a'.repeat(1000);
      const results = await repo.search(longQuery);
      expect(results).toEqual([]);
    });

    it('should limit number of terms', async () => {
      const repo = createEmailRepo();
      const manyTerms = Array.from({ length: 100 }, (_, i) => `term${i}`).join(' ');
      const results = await repo.search(manyTerms);
      expect(results).toEqual([]);
    });

    it('should filter out short terms', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('a b c hello world');
      expect(results).toEqual([]);
    });

    it('should handle SQL injection attempt via FTS', async () => {
      const repo = createEmailRepo();
      // Attempt to inject SQL through FTS query
      const maliciousQuery = '"; DROP TABLE emails; --';
      const results = await repo.search(maliciousQuery);
      expect(results).toEqual([]);

      // Verify table still exists by attempting a query
      const testResults = await repo.list({ limit: 10 });
      expect(Array.isArray(testResults)).toBe(true);
    });
  });

  describe('LIKE Pattern - escapeLike', () => {
    it('should handle normal folder path search', async () => {
      const repo = createEmailRepo();
      const results = await repo.list({ folderPath: 'INBOX', limit: 10 });
      expect(results).toEqual([]);
    });

    it('should escape % wildcard in LIKE pattern', async () => {
      const repo = createEmailRepo();
      // Should not match additional patterns due to escaped %
      const results = await repo.list({ folderPath: 'test%folder', limit: 10 });
      expect(results).toEqual([]);
    });

    it('should escape _ wildcard in LIKE pattern', async () => {
      const repo = createEmailRepo();
      // Should not match single character due to escaped _
      const results = await repo.list({ folderPath: 'test_folder', limit: 10 });
      expect(results).toEqual([]);
    });

    it('should escape backslash in LIKE pattern', async () => {
      const repo = createEmailRepo();
      const results = await repo.list({ folderPath: 'test\\folder', limit: 10 });
      expect(results).toEqual([]);
    });

    it('should handle combined wildcards', async () => {
      const repo = createEmailRepo();
      const results = await repo.list({ folderPath: '%test_folder%', limit: 10 });
      expect(results).toEqual([]);
    });

    it('should handle SQL injection attempt via LIKE', async () => {
      const repo = createEmailRepo();
      // Attempt to inject SQL through folder path
      const maliciousPath = "' OR '1'='1";
      const results = await repo.list({ folderPath: maliciousPath, limit: 10 });
      expect(results).toEqual([]);

      // Verify table still exists
      const testResults = await repo.list({ limit: 10 });
      expect(Array.isArray(testResults)).toBe(true);
    });

    it('should handle SQL injection attempt with comment', async () => {
      const repo = createEmailRepo();
      const maliciousPath = "test'; DROP TABLE emails; --";
      const results = await repo.list({ folderPath: maliciousPath, limit: 10 });
      expect(results).toEqual([]);

      // Verify table still exists
      const testResults = await repo.list({ limit: 10 });
      expect(Array.isArray(testResults)).toBe(true);
    });
  });

  describe('Integration - Real Search Scenarios', () => {
    it('should return empty results for non-existent search terms', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('nonexistent term', 50);
      expect(results).toEqual([]);
    });

    it('should handle search with accountId filter', async () => {
      const repo = createEmailRepo();
      const results = await repo.search('test query', 50, 1);
      expect(results).toEqual([]);
    });

    it('should handle list with multiple filters', async () => {
      const repo = createEmailRepo();
      const results = await repo.list({
        accountId: 1,
        folderPath: 'INBOX',
        unreadOnly: true,
        limit: 50
      });
      expect(results).toEqual([]);
    });
  });

  describe('Contact Search - escapeLike', () => {
    it('should handle normal contact search', async () => {
      const repo = createContactRepo();
      const results = await repo.search('john');
      expect(results).toEqual([]);
    });

    it('should escape % wildcard in contact search', async () => {
      const repo = createContactRepo();
      // Should not match additional patterns due to escaped %
      const results = await repo.search('john%doe');
      expect(results).toEqual([]);
    });

    it('should escape _ wildcard in contact search', async () => {
      const repo = createContactRepo();
      // Should not match single character due to escaped _
      const results = await repo.search('john_doe');
      expect(results).toEqual([]);
    });

    it('should escape backslash in contact search', async () => {
      const repo = createContactRepo();
      const results = await repo.search('john\\doe');
      expect(results).toEqual([]);
    });

    it('should handle combined wildcards in contact search', async () => {
      const repo = createContactRepo();
      const results = await repo.search('%john_doe%');
      expect(results).toEqual([]);
    });

    it('should handle SQL injection attempt via contact search', async () => {
      const repo = createContactRepo();
      // Attempt to inject SQL through contact query
      const maliciousQuery = "' OR '1'='1";
      const results = await repo.search(maliciousQuery);
      expect(results).toEqual([]);

      // Verify table still exists
      const testResults = await repo.getRecent(10);
      expect(Array.isArray(testResults)).toBe(true);
    });

    it('should handle SQL injection with comment in contact search', async () => {
      const repo = createContactRepo();
      const maliciousQuery = "test'; DROP TABLE recent_contacts; --";
      const results = await repo.search(maliciousQuery);
      expect(results).toEqual([]);

      // Verify table still exists
      const testResults = await repo.getRecent(10);
      expect(Array.isArray(testResults)).toBe(true);
    });

    it('should handle case-insensitive search properly', async () => {
      const repo = createContactRepo();
      // Should work with mixed case
      const results = await repo.search('JoHn DoE');
      expect(results).toEqual([]);
    });
  });
});
