/**
 * Classification State Repository Adapter
 *
 * Tracks AI classification state, user feedback, and accuracy metrics.
 */

import Database from 'better-sqlite3';
import type { ClassificationStateRepo } from '../../core/ports';
import type { ClassificationState, ClassificationFeedback, ConfusedPattern, ClassificationStats, ClassificationStatus } from '../../core/domain';

function mapState(row: any): ClassificationState {
  return {
    emailId: row.email_id,
    status: row.status,
    confidence: row.confidence,
    priority: row.priority,
    suggestedTags: row.suggested_tags ? JSON.parse(row.suggested_tags) : [],
    reasoning: row.reasoning,
    errorMessage: row.error_message,
    classifiedAt: row.classified_at ? new Date(row.classified_at) : null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    dismissedAt: row.dismissed_at ? new Date(row.dismissed_at) : null,
  };
}

function mapPattern(row: any): ConfusedPattern {
  return {
    id: row.id,
    patternType: row.pattern_type,
    patternValue: row.pattern_value,
    dismissalCount: row.dismissal_count,
    avgConfidence: row.avg_confidence,
    lastSeen: new Date(row.last_seen),
  };
}

function mapFeedback(row: any): ClassificationFeedback {
  return {
    id: row.id,
    emailId: row.email_id,
    action: row.action,
    originalTags: row.original_tags ? JSON.parse(row.original_tags) : [],
    finalTags: row.final_tags ? JSON.parse(row.final_tags) : null,
    accuracyScore: row.accuracy_score,
    createdAt: new Date(row.created_at),
  };
}

export function createClassificationStateRepo(getDb: () => Database.Database): ClassificationStateRepo {
  return {
    async getState(emailId) {
      const row = getDb().prepare(`
        SELECT * FROM classification_state WHERE email_id = ?
      `).get(emailId);
      return row ? mapState(row) : null;
    },

    async setState(state) {
      // Use special marker to distinguish "not provided" from "explicitly null"
      const KEEP_EXISTING = '__KEEP__';
      const reviewedAtValue = state.reviewedAt === undefined ? KEEP_EXISTING
        : (state.reviewedAt?.toISOString() ?? null);
      const dismissedAtValue = state.dismissedAt === undefined ? KEEP_EXISTING
        : (state.dismissedAt?.toISOString() ?? null);

      getDb().prepare(`
        INSERT INTO classification_state (
          email_id, status, confidence, priority, suggested_tags, reasoning,
          error_message, classified_at, reviewed_at, dismissed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email_id) DO UPDATE SET
          status = excluded.status,
          confidence = excluded.confidence,
          priority = excluded.priority,
          suggested_tags = excluded.suggested_tags,
          reasoning = excluded.reasoning,
          error_message = excluded.error_message,
          classified_at = excluded.classified_at,
          reviewed_at = CASE WHEN excluded.reviewed_at = '${KEEP_EXISTING}' THEN reviewed_at ELSE excluded.reviewed_at END,
          dismissed_at = CASE WHEN excluded.dismissed_at = '${KEEP_EXISTING}' THEN dismissed_at ELSE excluded.dismissed_at END
      `).run(
        state.emailId,
        state.status,
        state.confidence,
        state.priority,
        JSON.stringify(state.suggestedTags),
        state.reasoning,
        state.errorMessage ?? null,
        state.classifiedAt?.toISOString() ?? null,
        reviewedAtValue,
        dismissedAtValue
      );
    },

    async listPendingReview(options: { limit?: number; offset?: number; sortBy?: 'confidence' | 'date' | 'sender'; accountId?: number } = {}) {
      const { limit = 100, offset = 0, sortBy = 'confidence', accountId } = options;
      let orderBy: string;
      switch (sortBy) {
        case 'confidence': orderBy = 'cs.confidence ASC'; break;
        case 'sender': orderBy = 'e.from_address ASC'; break;
        case 'date':
        default: orderBy = 'e.date DESC'; break;
      }

      // Include both pending_review (low confidence) and classified (high confidence, auto-tagged)
      // This lets users review ALL classified emails, not just low-confidence ones
      let sql = `
        SELECT cs.*, e.date as email_date
        FROM classification_state cs
        JOIN emails e ON cs.email_id = e.id
        WHERE cs.status IN ('pending_review', 'classified')
      `;
      const params: any[] = [];

      if (accountId) {
        sql += ' AND e.account_id = ?';
        params.push(accountId);
      }

      sql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const rows = getDb().prepare(sql).all(...params);
      return rows.map(mapState);
    },

    async listByPriority(priority: string, options: { limit?: number; offset?: number; accountId?: number } = {}) {
      const { limit = 100, offset = 0, accountId } = options;

      let sql = `
        SELECT cs.*
        FROM classification_state cs
        JOIN emails e ON cs.email_id = e.id
        WHERE cs.priority = ? AND cs.status IN ('classified', 'accepted')
      `;
      const params: any[] = [priority];

      if (accountId) {
        sql += ' AND e.account_id = ?';
        params.push(accountId);
      }

      sql += ' ORDER BY e.date DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = getDb().prepare(sql).all(...params);
      return rows.map(mapState);
    },

    async listFailed(options: { limit?: number; offset?: number; accountId?: number } = {}) {
      const { limit = 100, offset = 0, accountId } = options;

      let sql = `
        SELECT cs.*
        FROM classification_state cs
        JOIN emails e ON cs.email_id = e.id
        WHERE cs.status = 'error'
      `;
      const params: any[] = [];

      if (accountId) {
        sql += ' AND e.account_id = ?';
        params.push(accountId);
      }

      sql += ' ORDER BY cs.classified_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = getDb().prepare(sql).all(...params);
      return rows.map(mapState);
    },

    async countByStatus(accountId?: number) {
      let sql = `
        SELECT cs.status, COUNT(*) as count
        FROM classification_state cs
      `;
      const params: any[] = [];

      if (accountId) {
        sql += ' JOIN emails e ON cs.email_id = e.id WHERE e.account_id = ?';
        params.push(accountId);
        sql += ' GROUP BY cs.status';
      } else {
        sql += ' GROUP BY cs.status';
      }

      const rows = getDb().prepare(sql).all(...params) as { status: ClassificationStatus; count: number }[];

      const counts: Record<ClassificationStatus, number> = {
        unprocessed: 0,
        classified: 0,
        pending_review: 0,
        accepted: 0,
        dismissed: 0,
        error: 0,
      };

      for (const row of rows) {
        counts[row.status] = row.count;
      }

      return counts;
    },

    async listReclassifiable(cooldownDays) {
      const rows = getDb().prepare(`
        SELECT email_id FROM classification_state
        WHERE status = 'dismissed'
        AND dismissed_at < datetime('now', '-' || ? || ' days')
      `).all(cooldownDays) as { email_id: number }[];

      return rows.map(r => r.email_id);
    },

    async logFeedback(feedback) {
      getDb().prepare(`
        INSERT INTO classification_feedback (
          email_id, action, original_tags, final_tags, accuracy_score
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        feedback.emailId,
        feedback.action,
        JSON.stringify(feedback.originalTags),
        feedback.finalTags ? JSON.stringify(feedback.finalTags) : null,
        feedback.accuracyScore
      );
    },

    async listRecentFeedback(limit = 10) {
      const rows = getDb().prepare(`
        SELECT * FROM classification_feedback
        ORDER BY created_at DESC
        LIMIT ?
      `).all(limit);

      return rows.map(mapFeedback);
    },

    async getStats() {
      const db = getDb();

      const todayRow = db.prepare(`
        SELECT COUNT(*) as count FROM classification_state
        WHERE date(classified_at) = date('now')
      `).get() as { count: number };

      const pendingRow = db.prepare(`
        SELECT COUNT(*) as count FROM classification_state
        WHERE status = 'pending_review'
      `).get() as { count: number };

      const accuracy = await this.getAccuracy30Day();

      const budgetRow = db.prepare(`
        SELECT COALESCE(SUM(tokens), 0) as used FROM llm_usage
        WHERE date = date('now')
      `).get() as { used: number };

      // Priority breakdown
      const priorityRows = db.prepare(`
        SELECT priority, COUNT(*) as count FROM classification_state
        WHERE priority IS NOT NULL
        GROUP BY priority
      `).all() as { priority: string; count: number }[];

      const priorityBreakdown = { high: 0, normal: 0, low: 0 };
      for (const row of priorityRows) {
        if (row.priority in priorityBreakdown) {
          priorityBreakdown[row.priority as keyof typeof priorityBreakdown] = row.count;
        }
      }

      return {
        classifiedToday: todayRow.count,
        pendingReview: pendingRow.count,
        accuracy30Day: accuracy,
        budgetUsed: budgetRow.used,
        budgetLimit: 200,
        priorityBreakdown,
      };
    },

    async getAccuracy30Day() {
      const row = getDb().prepare(`
        SELECT AVG(accuracy_score) as avg
        FROM classification_feedback
        WHERE created_at > datetime('now', '-30 days')
      `).get() as { avg: number | null };

      return row.avg ?? 0;
    },

    async listConfusedPatterns(limit = 5) {
      const rows = getDb().prepare(`
        SELECT * FROM confused_patterns
        ORDER BY dismissal_count DESC
        LIMIT ?
      `).all(limit);

      return rows.map(mapPattern);
    },

    async updateConfusedPattern(patternType, patternValue, confidence) {
      getDb().prepare(`
        INSERT INTO confused_patterns (pattern_type, pattern_value, dismissal_count, avg_confidence, last_seen)
        VALUES (?, ?, 1, ?, datetime('now'))
        ON CONFLICT(pattern_type, pattern_value) DO UPDATE SET
          dismissal_count = dismissal_count + 1,
          avg_confidence = (avg_confidence * dismissal_count + ?) / (dismissal_count + 1),
          last_seen = datetime('now')
      `).run(patternType, patternValue, confidence, confidence);
    },

    async clearConfusedPatterns() {
      getDb().prepare(`DELETE FROM confused_patterns`).run();
    },
  };
}
