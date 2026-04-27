/**
 * Security event repository (#98).
 *
 * Append-only audit log of security-relevant events: credential reads,
 * prompt-injection findings, classifier fallback transitions. Feeds the
 * Security > Audit log settings panel and is the ground truth for any
 * incident review.
 */

import Database from 'better-sqlite3';
import type { SecurityEventRepo, SecurityEvent, SecurityEventEntry, SecuritySeverity } from '../../core/ports';

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function mapRow(row: any): SecurityEvent {
  return {
    id: row.id,
    ts: new Date(row.ts),
    eventType: row.event_type,
    severity: row.severity as SecuritySeverity,
    actor: row.actor,
    target: row.target ?? null,
    success: !!row.success,
    metadata: parseMetadata(row.metadata),
  };
}

export function createSecurityEventRepo(getDb: () => Database.Database): SecurityEventRepo {
  return {
    async record(entry: SecurityEventEntry) {
      getDb().prepare(`
        INSERT INTO security_events (event_type, severity, actor, target, success, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        entry.eventType,
        entry.severity,
        entry.actor,
        entry.target ?? null,
        entry.success === false ? 0 : 1,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      );
    },

    async listRecent(options = {}) {
      const limit = Math.min(Math.max(1, options.limit ?? 100), 1000);
      const clauses: string[] = [];
      const params: any[] = [];

      if (options.eventType) {
        clauses.push('event_type = ?');
        params.push(options.eventType);
      }
      if (options.severity) {
        clauses.push('severity = ?');
        params.push(options.severity);
      }
      if (options.sinceTs) {
        clauses.push('ts >= ?');
        params.push(options.sinceTs.toISOString());
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const sql = `SELECT * FROM security_events ${where} ORDER BY ts DESC LIMIT ?`;
      params.push(limit);
      const rows = getDb().prepare(sql).all(...params) as any[];
      return rows.map(mapRow);
    },

    async countByType(options = {}) {
      const rows = options.sinceTs
        ? getDb().prepare(`
            SELECT event_type, COUNT(*) AS n FROM security_events
            WHERE ts >= ?
            GROUP BY event_type
          `).all(options.sinceTs.toISOString()) as any[]
        : getDb().prepare(`
            SELECT event_type, COUNT(*) AS n FROM security_events
            GROUP BY event_type
          `).all() as any[];
      const out: Record<string, number> = {};
      for (const row of rows) out[row.event_type] = Number(row.n) || 0;
      return out;
    },

    async prune(keepDays: number) {
      const days = Math.max(1, Math.floor(keepDays));
      const result = getDb().prepare(
        `DELETE FROM security_events WHERE ts < datetime('now', ?)`
      ).run(`-${days} days`);
      return Number(result.changes) || 0;
    },
  };
}
