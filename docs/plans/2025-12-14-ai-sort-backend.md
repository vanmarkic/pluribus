# AI Sort Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement backend infrastructure for AI Sort view: classification state tracking, pending review queue, accuracy metrics, and confused patterns detection.

**Architecture:** Extend existing classification system with new database tables for tracking classification state, user feedback, and accuracy metrics. Add new use cases and IPC handlers for dashboard stats, pending review queue, and feedback logging.

**Tech Stack:** SQLite (better-sqlite3), TypeScript, existing functional Clean Architecture patterns.

---

## Task 1: Add Classification State Schema

**Files:**
- Modify: `src/adapters/db/schema.sql`

**Step 1: Write the schema migration**

Add new tables for tracking classification state, user feedback, and accuracy metrics.

```sql
-- Classification State (tracks each email's AI classification status)
CREATE TABLE IF NOT EXISTS classification_state (
  email_id INTEGER PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unprocessed',  -- unprocessed, classified, pending_review, accepted, dismissed
  confidence REAL,
  priority TEXT,  -- high, normal, low
  suggested_tags TEXT,  -- JSON array of tag slugs
  reasoning TEXT,
  classified_at TEXT,
  reviewed_at TEXT,
  dismissed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_classification_status ON classification_state(status);
CREATE INDEX IF NOT EXISTS idx_classification_confidence ON classification_state(confidence);

-- Classification Feedback (logs user actions for accuracy tracking)
CREATE TABLE IF NOT EXISTS classification_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  action TEXT NOT NULL,  -- accept, accept_edit, dismiss
  original_tags TEXT,    -- JSON array: what AI suggested
  final_tags TEXT,       -- JSON array: what user applied (null if dismissed)
  accuracy_score REAL,   -- 1.0 for accept, 0.98 for accept_edit, 0.0 for dismiss
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feedback_email ON classification_feedback(email_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON classification_feedback(created_at);

-- Confused Patterns (aggregates patterns where AI struggles)
CREATE TABLE IF NOT EXISTS confused_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_type TEXT NOT NULL,  -- sender_domain, subject_pattern
  pattern_value TEXT NOT NULL,
  dismissal_count INTEGER NOT NULL DEFAULT 0,
  avg_confidence REAL,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pattern_type, pattern_value)
);

CREATE INDEX IF NOT EXISTS idx_confused_patterns_count ON confused_patterns(dismissal_count DESC);
```

**Step 2: Run typecheck to verify no breaks**

Run: `npm run typecheck`
Expected: PASS (schema changes don't affect TypeScript)

**Step 3: Commit**

```bash
git add src/adapters/db/schema.sql
git commit -m "$(cat <<'EOF'
feat(db): add classification state tracking tables

- classification_state: tracks AI classification status per email
- classification_feedback: logs user actions for accuracy metrics
- confused_patterns: aggregates patterns where AI struggles

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Domain Types for Classification State

**Files:**
- Modify: `src/core/domain.ts`

**Step 1: Write the failing test**

Create test file `src/core/domain.test.ts` if it doesn't exist:

```typescript
import { describe, it, expect } from 'vitest';
import type { ClassificationState, ClassificationFeedback, ConfusedPattern, ClassificationStatus } from './domain';

describe('Classification Domain Types', () => {
  it('ClassificationStatus has correct values', () => {
    const statuses: ClassificationStatus[] = ['unprocessed', 'classified', 'pending_review', 'accepted', 'dismissed'];
    expect(statuses).toHaveLength(5);
  });

  it('ClassificationState has required fields', () => {
    const state: ClassificationState = {
      emailId: 1,
      status: 'pending_review',
      confidence: 0.72,
      priority: 'normal',
      suggestedTags: ['work'],
      reasoning: 'Contains work keywords',
      classifiedAt: new Date(),
      reviewedAt: null,
      dismissedAt: null,
    };
    expect(state.status).toBe('pending_review');
  });

  it('ClassificationFeedback has required fields', () => {
    const feedback: ClassificationFeedback = {
      id: 1,
      emailId: 1,
      action: 'accept_edit',
      originalTags: ['work'],
      finalTags: ['work', 'urgent'],
      accuracyScore: 0.98,
      createdAt: new Date(),
    };
    expect(feedback.action).toBe('accept_edit');
  });

  it('ConfusedPattern has required fields', () => {
    const pattern: ConfusedPattern = {
      id: 1,
      patternType: 'sender_domain',
      patternValue: 'newsletter.com',
      dismissalCount: 12,
      avgConfidence: 0.52,
      lastSeen: new Date(),
    };
    expect(pattern.dismissalCount).toBe(12);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/core/domain.test.ts`
Expected: FAIL with type import errors

**Step 3: Write minimal implementation**

Add to `src/core/domain.ts`:

```typescript
// ============================================
// Classification State (AI Sort)
// ============================================

export type ClassificationStatus = 'unprocessed' | 'classified' | 'pending_review' | 'accepted' | 'dismissed';

export type ClassificationState = {
  emailId: number;
  status: ClassificationStatus;
  confidence: number | null;
  priority: 'high' | 'normal' | 'low' | null;
  suggestedTags: string[];
  reasoning: string | null;
  classifiedAt: Date | null;
  reviewedAt: Date | null;
  dismissedAt: Date | null;
};

export type FeedbackAction = 'accept' | 'accept_edit' | 'dismiss';

export type ClassificationFeedback = {
  id: number;
  emailId: number;
  action: FeedbackAction;
  originalTags: string[];
  finalTags: string[] | null;
  accuracyScore: number;
  createdAt: Date;
};

export type ConfusedPattern = {
  id: number;
  patternType: 'sender_domain' | 'subject_pattern';
  patternValue: string;
  dismissalCount: number;
  avgConfidence: number | null;
  lastSeen: Date;
};

export type ClassificationStats = {
  classifiedToday: number;
  pendingReview: number;
  accuracy30Day: number;
  budgetUsed: number;
  budgetLimit: number;
};
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/core/domain.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/domain.ts src/core/domain.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add classification state types

- ClassificationState: tracks AI classification per email
- ClassificationFeedback: user feedback for accuracy
- ConfusedPattern: patterns where AI struggles
- ClassificationStats: dashboard metrics

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add Classification State Repository Port

**Files:**
- Modify: `src/core/ports.ts`

**Step 1: Write the port interface**

Add to `src/core/ports.ts` after the existing `Classifier` type:

```typescript
// ============================================
// Classification State Repository
// ============================================

export type ClassificationStateRepo = {
  // State management
  getState: (emailId: number) => Promise<ClassificationState | null>;
  setState: (state: Omit<ClassificationState, 'reviewedAt' | 'dismissedAt'> & { reviewedAt?: Date | null; dismissedAt?: Date | null }) => Promise<void>;

  // Queries for AI Sort view
  listPendingReview: (options?: { limit?: number; offset?: number; sortBy?: 'confidence' | 'date' }) => Promise<ClassificationState[]>;
  listByPriority: (priority: 'high' | 'normal' | 'low', options?: { limit?: number; offset?: number }) => Promise<ClassificationState[]>;
  countByStatus: () => Promise<Record<ClassificationStatus, number>>;

  // Re-classification (dismissed emails after cooldown)
  listReclassifiable: (cooldownDays: number) => Promise<number[]>;  // Returns email IDs

  // Feedback logging
  logFeedback: (feedback: Omit<ClassificationFeedback, 'id' | 'createdAt'>) => Promise<void>;

  // Stats & metrics
  getStats: () => Promise<ClassificationStats>;
  getAccuracy30Day: () => Promise<number>;

  // Confused patterns
  listConfusedPatterns: (limit?: number) => Promise<ConfusedPattern[]>;
  updateConfusedPattern: (patternType: 'sender_domain' | 'subject_pattern', patternValue: string, confidence: number) => Promise<void>;
};
```

**Step 2: Add to Deps type**

Modify the `Deps` type in `src/core/ports.ts`:

```typescript
export type Deps = {
  emails: EmailRepo;
  attachments: AttachmentRepo;
  tags: TagRepo;
  accounts: AccountRepo;
  folders: FolderRepo;
  sync: MailSync;
  classifier: Classifier;
  classificationState: ClassificationStateRepo;  // ADD THIS
  secrets: SecureStorage;
  sender: MailSender;
  config: ConfigStore;
  imageCache: ImageCache;
};
```

**Step 3: Update LLMConfig type**

Add reclassify cooldown to `LLMConfig`:

```typescript
export type LLMConfig = {
  model: 'claude-sonnet-4-20250514' | 'claude-haiku-4-20250514';
  dailyBudget: number;
  dailyEmailLimit: number;
  autoClassify: boolean;
  confidenceThreshold: number;
  reclassifyCooldownDays: number;  // ADD THIS - default 7
};
```

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL (container.ts and other files need updates)

**Step 5: Commit (partial - ports only)**

```bash
git add src/core/ports.ts
git commit -m "$(cat <<'EOF'
feat(ports): add ClassificationStateRepo interface

- State management: getState, setState
- Query methods: listPendingReview, listByPriority, countByStatus
- Feedback: logFeedback
- Stats: getStats, getAccuracy30Day
- Confused patterns: listConfusedPatterns, updateConfusedPattern
- Reclassification: listReclassifiable with cooldown support

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Implement Classification State Repository Adapter

**Files:**
- Create: `src/adapters/db/classification-state.ts`

**Step 1: Write the failing test**

Create `src/adapters/db/classification-state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { createClassificationStateRepo } from './classification-state';

describe('ClassificationStateRepo', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createClassificationStateRepo>;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaPath = path.join(__dirname, 'schema.sql');
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));

    // Insert test email
    db.prepare(`
      INSERT INTO accounts (name, email, imap_host, smtp_host, username)
      VALUES ('Test', 'test@example.com', 'imap.test.com', 'smtp.test.com', 'test')
    `).run();
    db.prepare(`
      INSERT INTO folders (account_id, path, name)
      VALUES (1, 'INBOX', 'Inbox')
    `).run();
    db.prepare(`
      INSERT INTO emails (message_id, account_id, folder_id, uid, from_address, to_addresses, date)
      VALUES ('<test@example.com>', 1, 1, 1, 'sender@example.com', '["test@example.com"]', datetime('now'))
    `).run();

    repo = createClassificationStateRepo(() => db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getState', () => {
    it('returns null for unclassified email', async () => {
      const state = await repo.getState(1);
      expect(state).toBeNull();
    });

    it('returns state for classified email', async () => {
      await repo.setState({
        emailId: 1,
        status: 'pending_review',
        confidence: 0.72,
        priority: 'normal',
        suggestedTags: ['work'],
        reasoning: 'Contains work keywords',
        classifiedAt: new Date(),
      });

      const state = await repo.getState(1);
      expect(state).not.toBeNull();
      expect(state?.status).toBe('pending_review');
      expect(state?.confidence).toBe(0.72);
    });
  });

  describe('listPendingReview', () => {
    it('returns only pending_review emails', async () => {
      await repo.setState({
        emailId: 1,
        status: 'pending_review',
        confidence: 0.72,
        priority: 'normal',
        suggestedTags: ['work'],
        reasoning: 'Test',
        classifiedAt: new Date(),
      });

      const pending = await repo.listPendingReview();
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('pending_review');
    });
  });

  describe('logFeedback', () => {
    it('logs accept feedback with 100% accuracy', async () => {
      await repo.logFeedback({
        emailId: 1,
        action: 'accept',
        originalTags: ['work'],
        finalTags: ['work'],
        accuracyScore: 1.0,
      });

      const accuracy = await repo.getAccuracy30Day();
      expect(accuracy).toBe(1.0);
    });

    it('logs accept_edit feedback with 98% accuracy', async () => {
      await repo.logFeedback({
        emailId: 1,
        action: 'accept_edit',
        originalTags: ['work'],
        finalTags: ['work', 'urgent'],
        accuracyScore: 0.98,
      });

      const accuracy = await repo.getAccuracy30Day();
      expect(accuracy).toBe(0.98);
    });
  });

  describe('countByStatus', () => {
    it('counts emails by classification status', async () => {
      await repo.setState({
        emailId: 1,
        status: 'pending_review',
        confidence: 0.72,
        priority: 'normal',
        suggestedTags: [],
        reasoning: null,
        classifiedAt: new Date(),
      });

      const counts = await repo.countByStatus();
      expect(counts.pending_review).toBe(1);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/adapters/db/classification-state.test.ts`
Expected: FAIL with "Cannot find module './classification-state'"

**Step 3: Write minimal implementation**

Create `src/adapters/db/classification-state.ts`:

```typescript
/**
 * Classification State Repository Adapter
 *
 * Tracks AI classification state, user feedback, and accuracy metrics.
 */

import type Database from 'better-sqlite3';
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

export function createClassificationStateRepo(getDb: () => Database.Database): ClassificationStateRepo {
  return {
    async getState(emailId) {
      const row = getDb().prepare(`
        SELECT * FROM classification_state WHERE email_id = ?
      `).get(emailId);
      return row ? mapState(row) : null;
    },

    async setState(state) {
      getDb().prepare(`
        INSERT INTO classification_state (
          email_id, status, confidence, priority, suggested_tags, reasoning,
          classified_at, reviewed_at, dismissed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email_id) DO UPDATE SET
          status = excluded.status,
          confidence = excluded.confidence,
          priority = excluded.priority,
          suggested_tags = excluded.suggested_tags,
          reasoning = excluded.reasoning,
          classified_at = excluded.classified_at,
          reviewed_at = COALESCE(excluded.reviewed_at, reviewed_at),
          dismissed_at = COALESCE(excluded.dismissed_at, dismissed_at)
      `).run(
        state.emailId,
        state.status,
        state.confidence,
        state.priority,
        JSON.stringify(state.suggestedTags),
        state.reasoning,
        state.classifiedAt?.toISOString() ?? null,
        state.reviewedAt?.toISOString() ?? null,
        state.dismissedAt?.toISOString() ?? null
      );
    },

    async listPendingReview(options = {}) {
      const { limit = 100, offset = 0, sortBy = 'confidence' } = options;
      const orderBy = sortBy === 'confidence' ? 'cs.confidence ASC' : 'e.date DESC';

      const rows = getDb().prepare(`
        SELECT cs.*, e.date as email_date
        FROM classification_state cs
        JOIN emails e ON cs.email_id = e.id
        WHERE cs.status = 'pending_review'
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      return rows.map(mapState);
    },

    async listByPriority(priority, options = {}) {
      const { limit = 100, offset = 0 } = options;

      const rows = getDb().prepare(`
        SELECT cs.*
        FROM classification_state cs
        JOIN emails e ON cs.email_id = e.id
        WHERE cs.priority = ? AND cs.status IN ('classified', 'accepted')
        ORDER BY e.date DESC
        LIMIT ? OFFSET ?
      `).all(priority, limit, offset);

      return rows.map(mapState);
    },

    async countByStatus() {
      const rows = getDb().prepare(`
        SELECT status, COUNT(*) as count FROM classification_state GROUP BY status
      `).all() as { status: ClassificationStatus; count: number }[];

      const counts: Record<ClassificationStatus, number> = {
        unprocessed: 0,
        classified: 0,
        pending_review: 0,
        accepted: 0,
        dismissed: 0,
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

    async getStats() {
      const db = getDb();

      // Classified today
      const todayRow = db.prepare(`
        SELECT COUNT(*) as count FROM classification_state
        WHERE date(classified_at) = date('now')
      `).get() as { count: number };

      // Pending review
      const pendingRow = db.prepare(`
        SELECT COUNT(*) as count FROM classification_state
        WHERE status = 'pending_review'
      `).get() as { count: number };

      // 30-day accuracy
      const accuracy = await this.getAccuracy30Day();

      // Budget (from llm_usage table)
      const budgetRow = db.prepare(`
        SELECT COALESCE(SUM(tokens), 0) as used FROM llm_usage
        WHERE date = date('now')
      `).get() as { used: number };

      return {
        classifiedToday: todayRow.count,
        pendingReview: pendingRow.count,
        accuracy30Day: accuracy,
        budgetUsed: budgetRow.used,
        budgetLimit: 200, // Will be overridden by config in use case
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
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/adapters/db/classification-state.test.ts`
Expected: PASS

**Step 5: Export from db index**

Add to `src/adapters/db/index.ts`:

```typescript
export { createClassificationStateRepo } from './classification-state';
```

**Step 6: Commit**

```bash
git add src/adapters/db/classification-state.ts src/adapters/db/classification-state.test.ts src/adapters/db/index.ts
git commit -m "$(cat <<'EOF'
feat(adapters): implement ClassificationStateRepo

- State CRUD: getState, setState with upsert
- Query: listPendingReview, listByPriority, countByStatus
- Feedback: logFeedback with accuracy scoring
- Stats: getStats, getAccuracy30Day
- Confused patterns: listConfusedPatterns, updateConfusedPattern
- Reclassification: listReclassifiable with cooldown

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add AI Sort Use Cases

**Files:**
- Modify: `src/core/usecases.ts`

**Step 1: Write the failing tests**

Add to `src/core/usecases.test.ts`:

```typescript
// ============================================
// AI Sort Use Case Tests
// ============================================

import {
  getPendingReviewQueue,
  getClassificationStats,
  acceptClassification,
  dismissClassification,
  getConfusedPatterns,
} from './usecases';

function createMockClassificationStateRepo(overrides = {}) {
  return {
    getState: vi.fn().mockResolvedValue(null),
    setState: vi.fn().mockResolvedValue(undefined),
    listPendingReview: vi.fn().mockResolvedValue([]),
    listByPriority: vi.fn().mockResolvedValue([]),
    countByStatus: vi.fn().mockResolvedValue({ unprocessed: 0, classified: 0, pending_review: 0, accepted: 0, dismissed: 0 }),
    listReclassifiable: vi.fn().mockResolvedValue([]),
    logFeedback: vi.fn().mockResolvedValue(undefined),
    getStats: vi.fn().mockResolvedValue({ classifiedToday: 0, pendingReview: 0, accuracy30Day: 0, budgetUsed: 0, budgetLimit: 200 }),
    getAccuracy30Day: vi.fn().mockResolvedValue(0),
    listConfusedPatterns: vi.fn().mockResolvedValue([]),
    updateConfusedPattern: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('getPendingReviewQueue', () => {
  it('returns pending review emails sorted by confidence', async () => {
    const pendingStates = [
      { emailId: 1, status: 'pending_review', confidence: 0.72, priority: 'normal', suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null },
      { emailId: 2, status: 'pending_review', confidence: 0.65, priority: 'low', suggestedTags: ['personal'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null },
    ];
    const classificationState = createMockClassificationStateRepo({
      listPendingReview: vi.fn().mockResolvedValue(pendingStates),
    });
    const emails = createMockEmailRepo({
      findById: vi.fn().mockImplementation((id) => Promise.resolve({ ...testEmail, id })),
    });

    const result = await getPendingReviewQueue({ classificationState, emails })({ sortBy: 'confidence' });

    expect(classificationState.listPendingReview).toHaveBeenCalledWith({ sortBy: 'confidence' });
    expect(result).toHaveLength(2);
  });
});

describe('getClassificationStats', () => {
  it('returns dashboard stats with budget from config', async () => {
    const classificationState = createMockClassificationStateRepo({
      getStats: vi.fn().mockResolvedValue({ classifiedToday: 50, pendingReview: 7, accuracy30Day: 0.89, budgetUsed: 100, budgetLimit: 200 }),
    });
    const config = createMockConfig();
    const classifier = createMockClassifier({
      getEmailBudget: vi.fn().mockReturnValue({ used: 100, limit: 200, allowed: true }),
    });

    const result = await getClassificationStats({ classificationState, config, classifier })();

    expect(result.classifiedToday).toBe(50);
    expect(result.pendingReview).toBe(7);
    expect(result.accuracy30Day).toBe(0.89);
  });
});

describe('acceptClassification', () => {
  it('accepts with 100% accuracy when no edits', async () => {
    const state = { emailId: 1, status: 'pending_review', confidence: 0.72, priority: 'normal', suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null };
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(state),
    });
    const tags = createMockTagRepo({
      findAll: vi.fn().mockResolvedValue(testTags),
    });

    await acceptClassification({ classificationState, tags })(1, ['work']);

    expect(classificationState.logFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: 'accept',
      accuracyScore: 1.0,
    }));
    expect(classificationState.setState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'accepted',
    }));
  });

  it('accepts with 98% accuracy when tags edited', async () => {
    const state = { emailId: 1, status: 'pending_review', confidence: 0.72, priority: 'normal', suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null };
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(state),
    });
    const tags = createMockTagRepo({
      findAll: vi.fn().mockResolvedValue(testTags),
    });

    await acceptClassification({ classificationState, tags })(1, ['work', 'personal']);

    expect(classificationState.logFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: 'accept_edit',
      accuracyScore: 0.98,
    }));
  });
});

describe('dismissClassification', () => {
  it('dismisses with 0% accuracy and updates confused patterns', async () => {
    const state = { emailId: 1, status: 'pending_review', confidence: 0.72, priority: 'normal', suggestedTags: ['work'], reasoning: 'Test', classifiedAt: new Date(), reviewedAt: null, dismissedAt: null };
    const classificationState = createMockClassificationStateRepo({
      getState: vi.fn().mockResolvedValue(state),
    });
    const emails = createMockEmailRepo({
      findById: vi.fn().mockResolvedValue(testEmail),
    });

    await dismissClassification({ classificationState, emails })(1);

    expect(classificationState.logFeedback).toHaveBeenCalledWith(expect.objectContaining({
      action: 'dismiss',
      accuracyScore: 0.0,
    }));
    expect(classificationState.setState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'dismissed',
    }));
    expect(classificationState.updateConfusedPattern).toHaveBeenCalled();
  });
});

describe('getConfusedPatterns', () => {
  it('returns top confused patterns', async () => {
    const patterns = [
      { id: 1, patternType: 'sender_domain', patternValue: 'newsletter.com', dismissalCount: 12, avgConfidence: 0.52, lastSeen: new Date() },
    ];
    const classificationState = createMockClassificationStateRepo({
      listConfusedPatterns: vi.fn().mockResolvedValue(patterns),
    });

    const result = await getConfusedPatterns({ classificationState })(5);

    expect(result).toHaveLength(1);
    expect(result[0].dismissalCount).toBe(12);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/core/usecases.test.ts`
Expected: FAIL with import errors

**Step 3: Write minimal implementation**

Add to `src/core/usecases.ts`:

```typescript
// ============================================
// AI Sort Use Cases
// ============================================

import type { ClassificationState, ClassificationStats, ConfusedPattern } from './domain';
import { extractDomain } from './domain';

export type PendingReviewOptions = {
  limit?: number;
  offset?: number;
  sortBy?: 'confidence' | 'date';
};

export type PendingReviewItem = ClassificationState & {
  email: Email;
};

export const getPendingReviewQueue = (deps: Pick<Deps, 'classificationState' | 'emails'>) =>
  async (options: PendingReviewOptions = {}): Promise<PendingReviewItem[]> => {
    const states = await deps.classificationState.listPendingReview(options);

    const items: PendingReviewItem[] = [];
    for (const state of states) {
      const email = await deps.emails.findById(state.emailId);
      if (email) {
        items.push({ ...state, email });
      }
    }

    return items;
  };

export const getClassificationStats = (deps: Pick<Deps, 'classificationState' | 'config' | 'classifier'>) =>
  async (): Promise<ClassificationStats> => {
    const stats = await deps.classificationState.getStats();
    const budget = deps.classifier.getEmailBudget();

    return {
      ...stats,
      budgetUsed: budget.used,
      budgetLimit: budget.limit,
    };
  };

export const acceptClassification = (deps: Pick<Deps, 'classificationState' | 'tags'>) =>
  async (emailId: number, appliedTags: string[]): Promise<void> => {
    const state = await deps.classificationState.getState(emailId);
    if (!state) throw new Error('Classification state not found');

    // Determine if tags were edited
    const originalSet = new Set(state.suggestedTags);
    const appliedSet = new Set(appliedTags);
    const isExactMatch = originalSet.size === appliedSet.size &&
      [...originalSet].every(tag => appliedSet.has(tag));

    const action = isExactMatch ? 'accept' : 'accept_edit';
    const accuracyScore = isExactMatch ? 1.0 : 0.98;

    // Log feedback
    await deps.classificationState.logFeedback({
      emailId,
      action,
      originalTags: state.suggestedTags,
      finalTags: appliedTags,
      accuracyScore,
    });

    // Update state
    await deps.classificationState.setState({
      ...state,
      status: 'accepted',
      reviewedAt: new Date(),
    });

    // Apply tags to email
    const allTags = await deps.tags.findAll();
    for (const tagSlug of appliedTags) {
      const tag = allTags.find(t => t.slug === tagSlug);
      if (tag) {
        await deps.tags.apply(emailId, tag.id, 'llm', state.confidence ?? undefined);
      }
    }
  };

export const dismissClassification = (deps: Pick<Deps, 'classificationState' | 'emails'>) =>
  async (emailId: number): Promise<void> => {
    const state = await deps.classificationState.getState(emailId);
    if (!state) throw new Error('Classification state not found');

    const email = await deps.emails.findById(emailId);

    // Log feedback
    await deps.classificationState.logFeedback({
      emailId,
      action: 'dismiss',
      originalTags: state.suggestedTags,
      finalTags: null,
      accuracyScore: 0.0,
    });

    // Update state
    await deps.classificationState.setState({
      ...state,
      status: 'dismissed',
      dismissedAt: new Date(),
    });

    // Update confused patterns
    if (email) {
      const domain = extractDomain(email.from.address);
      await deps.classificationState.updateConfusedPattern(
        'sender_domain',
        domain,
        state.confidence ?? 0
      );
    }
  };

export const getConfusedPatterns = (deps: Pick<Deps, 'classificationState'>) =>
  (limit = 5): Promise<ConfusedPattern[]> =>
    deps.classificationState.listConfusedPatterns(limit);

export const getPendingReviewCount = (deps: Pick<Deps, 'classificationState'>) =>
  async (): Promise<number> => {
    const counts = await deps.classificationState.countByStatus();
    return counts.pending_review;
  };
```

**Step 4: Update classifyAndApply to track state**

Modify `classifyAndApply` in `src/core/usecases.ts`:

```typescript
export const classifyAndApply = (deps: Pick<Deps, 'emails' | 'tags' | 'classifier' | 'classificationState'>) =>
  async (emailId: number, confidenceThreshold = 0.85): Promise<Classification> => {
    const result = await classifyEmail(deps)(emailId);

    // Determine status based on confidence
    const status = result.confidence >= confidenceThreshold ? 'classified' : 'pending_review';

    // Save classification state
    await deps.classificationState.setState({
      emailId,
      status,
      confidence: result.confidence,
      priority: result.priority,
      suggestedTags: result.suggestedTags,
      reasoning: result.reasoning,
      classifiedAt: new Date(),
    });

    // Only auto-apply tags if above threshold
    if (result.confidence >= confidenceThreshold) {
      const allTags = await deps.tags.findAll();

      for (const tagSlug of result.suggestedTags) {
        const tag = allTags.find(t => t.slug === tagSlug);
        if (tag) {
          await deps.tags.apply(emailId, tag.id, 'llm', result.confidence);
        }
      }
    }

    return result;
  };
```

**Step 5: Add to createUseCases factory**

Add the new use cases to the factory in `src/core/usecases.ts`:

```typescript
export function createUseCases(deps: Deps) {
  return {
    // ... existing use cases ...

    // AI Sort
    getPendingReviewQueue: getPendingReviewQueue(deps),
    getClassificationStats: getClassificationStats(deps),
    acceptClassification: acceptClassification(deps),
    dismissClassification: dismissClassification(deps),
    getConfusedPatterns: getConfusedPatterns(deps),
    getPendingReviewCount: getPendingReviewCount(deps),
  };
}
```

**Step 6: Run tests**

Run: `npm test -- src/core/usecases.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/core/usecases.ts src/core/usecases.test.ts
git commit -m "$(cat <<'EOF'
feat(usecases): add AI Sort use cases

- getPendingReviewQueue: list emails needing review
- getClassificationStats: dashboard metrics
- acceptClassification: accept with 100% or 98% accuracy
- dismissClassification: dismiss and track confused patterns
- getConfusedPatterns: list patterns where AI struggles
- getPendingReviewCount: for sidebar badge
- Update classifyAndApply to track state

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire Up Container

**Files:**
- Modify: `src/main/container.ts`

**Step 1: Import and create adapter**

Update `src/main/container.ts`:

```typescript
import { initDb, closeDb, getDb, createEmailRepo, createAttachmentRepo, createTagRepo, createAccountRepo, createFolderRepo, createClassificationStateRepo } from '../adapters/db';

// In createContainer():
const classificationState = createClassificationStateRepo(getDb);

// Update deps:
const deps: Deps = {
  emails,
  attachments,
  tags,
  accounts,
  folders,
  sync,
  classifier,
  classificationState,  // ADD THIS
  secrets,
  sender,
  config,
  imageCache,
};
```

**Step 2: Add reclassifyCooldownDays to config defaults**

Update `configStore` defaults:

```typescript
const configStore = new Store<AppConfig>({
  defaults: {
    llm: {
      model: 'claude-haiku-4-20250514',
      dailyBudget: 100000,
      dailyEmailLimit: 200,
      autoClassify: false,
      confidenceThreshold: 0.85,
      reclassifyCooldownDays: 7,  // ADD THIS
    },
    security: {
      remoteImages: 'block',
    },
  },
});
```

**Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/main/container.ts
git commit -m "$(cat <<'EOF'
feat(container): wire ClassificationStateRepo

- Create and inject classificationState adapter
- Add reclassifyCooldownDays config default (7 days)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add IPC Handlers

**Files:**
- Modify: `src/main/ipc.ts`

**Step 1: Add AI Sort IPC handlers**

Add to `src/main/ipc.ts`:

```typescript
// ==========================================
// AI Sort
// ==========================================

ipcMain.handle('aiSort:getPendingReview', (_, opts) => {
  const validated: Record<string, unknown> = {};
  if (opts && typeof opts === 'object') {
    const o = opts as Record<string, unknown>;
    if (o.limit !== undefined) validated.limit = assertPositiveInt(o.limit, 'limit');
    if (o.offset !== undefined) validated.offset = assertNonNegativeInt(o.offset, 'offset');
    if (o.sortBy !== undefined) {
      const sortBy = assertString(o.sortBy, 'sortBy', 20);
      if (!['confidence', 'date'].includes(sortBy)) throw new Error('Invalid sortBy');
      validated.sortBy = sortBy;
    }
  }
  return useCases.getPendingReviewQueue(validated);
});

ipcMain.handle('aiSort:getStats', () => {
  return useCases.getClassificationStats();
});

ipcMain.handle('aiSort:getPendingCount', () => {
  return useCases.getPendingReviewCount();
});

ipcMain.handle('aiSort:accept', (_, emailId, appliedTags) => {
  const id = assertPositiveInt(emailId, 'emailId');
  if (!Array.isArray(appliedTags)) throw new Error('appliedTags must be an array');
  const tags = appliedTags.map((t, i) => assertString(t, `appliedTags[${i}]`, 50));
  return useCases.acceptClassification(id, tags);
});

ipcMain.handle('aiSort:dismiss', (_, emailId) => {
  return useCases.dismissClassification(assertPositiveInt(emailId, 'emailId'));
});

ipcMain.handle('aiSort:getConfusedPatterns', (_, limit) => {
  const l = limit !== undefined ? assertPositiveInt(limit, 'limit') : 5;
  return useCases.getConfusedPatterns(l);
});
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/main/ipc.ts
git commit -m "$(cat <<'EOF'
feat(ipc): add AI Sort handlers

- aiSort:getPendingReview - list pending review queue
- aiSort:getStats - dashboard statistics
- aiSort:getPendingCount - for sidebar badge
- aiSort:accept - accept classification with tags
- aiSort:dismiss - dismiss classification
- aiSort:getConfusedPatterns - list confused patterns

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Run Full Test Suite and Typecheck

**Files:** None (verification only)

**Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

**Step 2: Run all tests**

Run: `npm test`
Expected: PASS

**Step 3: Manual verification**

Run: `npm run dev:electron`
Expected: App starts without errors

---

## Summary

This plan adds:

1. **Database Schema** - 3 new tables: `classification_state`, `classification_feedback`, `confused_patterns`
2. **Domain Types** - `ClassificationState`, `ClassificationFeedback`, `ConfusedPattern`, `ClassificationStats`
3. **Port Interface** - `ClassificationStateRepo` with state management, queries, feedback, and stats
4. **Adapter** - SQLite implementation of `ClassificationStateRepo`
5. **Use Cases** - `getPendingReviewQueue`, `getClassificationStats`, `acceptClassification`, `dismissClassification`, `getConfusedPatterns`, `getPendingReviewCount`
6. **IPC Handlers** - 6 new handlers for AI Sort frontend

The frontend (Figma Make) will need these IPC endpoints:
- `aiSort:getPendingReview` - Get pending review queue
- `aiSort:getStats` - Get dashboard statistics
- `aiSort:getPendingCount` - Get pending count for sidebar badge
- `aiSort:accept` - Accept classification
- `aiSort:dismiss` - Dismiss classification
- `aiSort:getConfusedPatterns` - Get confused patterns for dashboard
