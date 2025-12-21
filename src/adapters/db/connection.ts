/**
 * Database Connection Management
 *
 * Handles SQLite connection lifecycle: init, get, close.
 * All repositories import getDb() from this module.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Connection State
// ============================================

let db: Database.Database | null = null;

// ============================================
// Connection Lifecycle
// ============================================

export interface InitDbOptions {
  checkIntegrity?: boolean;
}

export function initDb(dbPath: string, schemaPath?: string, options?: InitDbOptions): Database.Database {
  if (db) return db;

  // Poka-yoke: Fail fast if schema path provided but file doesn't exist
  if (schemaPath && !fs.existsSync(schemaPath)) {
    throw new Error(`Database schema not found: ${schemaPath}`);
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000');

  if (schemaPath) {
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  }

  // Run migrations for existing databases
  runMigrations(db);

  // Poka-yoke: Verify critical tables exist after schema load
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const tableNames = tables.map(t => t.name);
  const requiredTables = ['accounts', 'folders', 'emails'];
  const missing = requiredTables.filter(t => !tableNames.includes(t));
  if (missing.length > 0) {
    throw new Error(`Database schema incomplete - missing tables: ${missing.join(', ')}`);
  }

  // Optional: Run integrity check on startup
  if (options?.checkIntegrity) {
    const result = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
    const firstResult = result[0]?.quick_check;
    if (firstResult !== 'ok') {
      const errors = result.map(row => row.quick_check).filter(Boolean);
      console.warn('[DB] Database integrity issues detected on startup:', errors);
      // Don't throw - allow app to start but log the warning
    }
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}

// ============================================
// Database Health & Recovery
// ============================================

export interface IntegrityCheckResult {
  isHealthy: boolean;
  errors: string[];
}

/**
 * Checks database integrity using SQLite's built-in PRAGMA integrity_check.
 * This helps detect corruption early and enables graceful error handling.
 *
 * @param full - If true, performs full check. If false, performs quick check (default).
 * @returns Object with isHealthy boolean and any error messages found.
 */
export async function checkIntegrity(full: boolean = false): Promise<IntegrityCheckResult> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  try {
    // PRAGMA integrity_check returns "ok" if healthy, or list of errors
    // Use quick_check for faster validation (doesn't check UNIQUE constraints)
    const pragma = full ? 'integrity_check' : 'quick_check';
    const results = db.prepare(`PRAGMA ${pragma}`).all() as { integrity_check?: string; quick_check?: string }[];

    const resultKey = full ? 'integrity_check' : 'quick_check';
    const firstResult = results[0]?.[resultKey];

    if (firstResult === 'ok') {
      return { isHealthy: true, errors: [] };
    }

    // Extract error messages from results
    const errors = results.map(row => row[resultKey]).filter(Boolean) as string[];
    return { isHealthy: false, errors };
  } catch (error) {
    return {
      isHealthy: false,
      errors: [`Failed to run integrity check: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

/**
 * Creates a backup of the current database file.
 * Useful before attempting recovery operations on a corrupted database.
 *
 * @returns Path to the backup file
 */
export async function createDbBackup(): Promise<string> {
  if (!db) {
    throw new Error('Database not initialized');
  }

  try {
    // Get the current database file path
    const dbPath = db.name;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbPath}.${timestamp}.backup`;

    // Use SQLite's VACUUM INTO to create a backup
    // This also rebuilds the database, which can fix some types of corruption
    db.prepare(`VACUUM INTO ?`).run(backupPath);

    return backupPath;
  } catch (error) {
    throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================
// SQL Safety Utilities
// ============================================

/**
 * Escapes special characters in LIKE patterns to prevent SQL injection.
 * Escapes: % (matches any string), _ (matches any character), \ (escape char)
 */
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

/**
 * Sanitizes FTS query input to prevent injection attacks.
 * - Removes FTS special operators: * " ( ) { } [ ] ^ ~ \
 * - Removes boolean operators: AND, OR, NOT, NEAR
 * - Limits query length to prevent DoS
 * - Splits into individual terms and wraps each in quotes
 */
export function escapeFtsQuery(query: string): string | null {
  // Remove FTS special characters and boolean operators
  const sanitized = query
    .replace(/[*"(){}[\]^~\\]/g, ' ')  // Remove FTS special chars
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')  // Remove boolean operators
    .trim()
    .slice(0, 200);  // Limit query length

  if (!sanitized) return null;

  // Split into terms, filter short terms, and limit count
  const terms = sanitized.split(/\s+/).filter(t => t.length >= 2).slice(0, 10);
  if (terms.length === 0) return null;

  // Wrap each term in quotes and add prefix wildcard for partial matching
  return terms.map(t => `"${t}"*`).join(' ');
}

// ============================================
// Database Migrations
// ============================================

/**
 * Helper to check if a column exists in a table
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some(c => c.name === column);
}

/**
 * Runs database migrations to update schema for existing databases.
 * Each migration checks if it needs to run (idempotent).
 */
export function runMigrations(db: Database.Database): void {
  // Migration 1: Add suggested_folder column to classification_state
  if (!hasColumn(db, 'classification_state', 'suggested_folder')) {
    db.exec(`ALTER TABLE classification_state ADD COLUMN suggested_folder TEXT`);
    console.log('[DB Migration] Added suggested_folder column to classification_state');
  }

  // Migration 005: Add threading, awaiting reply, and unsubscribe columns
  if (!hasColumn(db, 'emails', 'thread_id')) {
    const migrationPath = path.join(__dirname, 'migrations', '005-threads-awaiting-unsubscribe.sql');
    const migration005 = fs.readFileSync(migrationPath, 'utf-8');

    // Remove comment lines first, then split by semicolon
    const sqlWithoutComments = migration005
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    // Split by semicolon and run each statement (ALTER TABLE can't be batched)
    const statements = sqlWithoutComments
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      try {
        db.exec(stmt);
      } catch (err: any) {
        // Ignore "duplicate column" errors for idempotent migrations
        if (!err.message.includes('duplicate column')) {
          throw err;
        }
      }
    }
    console.log('[DB Migration] Applied migration 005: threads, awaiting reply, unsubscribe');
  }
}
