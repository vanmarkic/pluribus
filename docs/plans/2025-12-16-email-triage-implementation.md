# Email Triage System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement hybrid folder-based email triage that auto-classifies emails into IMAP folders using pattern matching + LLM validation.

**Architecture:** Extends existing classification system. Adds new ports (EmailTriagePort), adapters (triage/), and use cases. Reuses existing Classifier, IMAP, and DB infrastructure.

**Tech Stack:** TypeScript, better-sqlite3, ImapFlow, Ollama/Anthropic SDK, React/Zustand

**Design Spec:** `docs/designs/2025-12-16-email-triage-system.md`

## Implementation Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Database Schema | ✅ Done | Triage tables added to schema.sql |
| Phase 2: Domain Types | ✅ Done | TriageFolder, TriageClassificationResult, etc. |
| Phase 3: Ports | ✅ Done | PatternMatcher, TriageClassifier, TrainingRepo, etc. |
| Phase 4: Pattern Matcher | ✅ Done | `src/adapters/triage/pattern-matcher.ts` |
| Phase 5: Triage Repos | ✅ Done | `src/adapters/db/triage-repos.ts` |
| Phase 6: IMAP Folder Ops | ✅ Done | createFolder, moveMessage, ensureTriageFolders |
| Phase 7: Triage Classifier | ✅ Done | `src/adapters/triage/triage-classifier.ts` |
| Phase 8: Use Cases | ✅ Done | triageAndMoveEmail, moveEmailToTriageFolder, etc. + Issue #53 fix |
| Phase 9: IPC Handlers | ✅ Done | triage:classifyAndMove, triage:moveToFolder, etc. |
| Phase 10: Container Wiring | ✅ Done | All deps wired in container.ts |
| Phase 11: Onboarding UI | ✅ Done | TrainingStep.tsx + ensureFolders call |
| Phase 12: Sidebar Updates | ✅ Done | Triage folders in sidebar |
| Phase 13: Integration | ✅ Done | 318 tests passing, Issue #52 and #53 fixed |

---

## Phase 1: Database Schema

### Task 1.1: Add Triage Tables to Schema

**Files:**
- Modify: `src/adapters/db/schema.sql`

**Step 1: Add schema extensions**

Add these tables at the end of `schema.sql`:

```sql
-- ============================================
-- Email Triage System
-- ============================================

-- Training examples (onboarding + corrections)
CREATE TABLE IF NOT EXISTS training_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,
  from_address TEXT NOT NULL,
  from_domain TEXT NOT NULL,
  subject TEXT NOT NULL,
  ai_suggestion TEXT,
  user_choice TEXT NOT NULL,
  was_correction INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',  -- onboarding, review_folder, manual_move
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_training_account ON training_examples(account_id);
CREATE INDEX IF NOT EXISTS idx_training_domain ON training_examples(from_domain);
CREATE INDEX IF NOT EXISTS idx_training_correction ON training_examples(was_correction);

-- Sender-based learned rules
CREATE TABLE IF NOT EXISTS sender_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL DEFAULT 'domain',  -- domain, email, subject_prefix
  target_folder TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  correction_count INTEGER NOT NULL DEFAULT 1,
  auto_apply INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, pattern, pattern_type)
);

CREATE INDEX IF NOT EXISTS idx_sender_rules_account ON sender_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_sender_rules_auto ON sender_rules(auto_apply) WHERE auto_apply = 1;

-- Email snoozes
CREATE TABLE IF NOT EXISTS email_snoozes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  snooze_until TEXT NOT NULL,
  original_folder TEXT NOT NULL,
  reason TEXT,  -- shipping, waiting_reply, manual
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email_id)
);

CREATE INDEX IF NOT EXISTS idx_snoozes_until ON email_snoozes(snooze_until);

-- Auto-delete schedules
CREATE TABLE IF NOT EXISTS email_auto_deletes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  delete_after TEXT NOT NULL,
  reason TEXT,  -- 2fa, promo, dev
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email_id)
);

CREATE INDEX IF NOT EXISTS idx_auto_deletes_after ON email_auto_deletes(delete_after);

-- Sent email tracking (for waiting-for-reply)
CREATE TABLE IF NOT EXISTS sent_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  thread_id TEXT,
  expecting_reply INTEGER NOT NULL DEFAULT 1,
  snooze_until TEXT,
  reply_received INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email_id)
);

CREATE INDEX IF NOT EXISTS idx_sent_tracking_expecting ON sent_tracking(expecting_reply, snooze_until);

-- Classification log (audit trail)
CREATE TABLE IF NOT EXISTS triage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  pattern_hint TEXT,
  llm_folder TEXT,
  llm_confidence REAL,
  pattern_agreed INTEGER,
  final_folder TEXT NOT NULL,
  source TEXT NOT NULL,  -- llm, pattern-fallback, sender_rule, user-override
  reasoning TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_triage_log_email ON triage_log(email_id);
CREATE INDEX IF NOT EXISTS idx_triage_log_created ON triage_log(created_at DESC);
```

**Step 2: Commit**

```bash
git add src/adapters/db/schema.sql
git commit -m "feat(triage): add database schema for email triage system

Spec: docs/designs/2025-12-16-email-triage-system.md#database-schema-extensions"
```

---

## Phase 2: Domain Types

### Task 2.1: Add Triage Domain Types

**Files:**
- Modify: `src/core/domain.ts`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#classification-result-type`

**Step 1: Add types to domain.ts**

Add after existing types:

```typescript
// ============================================
// Email Triage Types
// ============================================

export type TriageFolder =
  | 'INBOX'
  | 'Planning'
  | 'Review'
  | 'Paper-Trail/Invoices'
  | 'Paper-Trail/Admin'
  | 'Paper-Trail/Travel'
  | 'Feed'
  | 'Social'
  | 'Promotions'
  | 'Archive';

export type TriageClassificationResult = {
  folder: TriageFolder;
  tags: string[];
  confidence: number;
  snoozeUntil?: Date;
  autoDeleteAfter?: number; // minutes
  patternHint?: TriageFolder;
  patternAgreed: boolean;
  reasoning: string;
};

export type TrainingExample = {
  id: number;
  accountId: number;
  emailId: number | null;
  fromAddress: string;
  fromDomain: string;
  subject: string;
  aiSuggestion: string | null;
  userChoice: string;
  wasCorrection: boolean;
  source: 'onboarding' | 'review_folder' | 'manual_move';
  createdAt: Date;
};

export type SenderRule = {
  id: number;
  accountId: number;
  pattern: string;
  patternType: 'domain' | 'email' | 'subject_prefix';
  targetFolder: TriageFolder;
  confidence: number;
  correctionCount: number;
  autoApply: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type EmailSnooze = {
  id: number;
  emailId: number;
  snoozeUntil: Date;
  originalFolder: string;
  reason: 'shipping' | 'waiting_reply' | 'manual';
  createdAt: Date;
};

export type TriageLogEntry = {
  id: number;
  emailId: number;
  accountId: number;
  patternHint: string | null;
  llmFolder: string | null;
  llmConfidence: number | null;
  patternAgreed: boolean | null;
  finalFolder: string;
  source: 'llm' | 'pattern-fallback' | 'sender_rule' | 'user-override';
  reasoning: string | null;
  createdAt: Date;
};

export const TRIAGE_FOLDERS: TriageFolder[] = [
  'INBOX',
  'Planning',
  'Review',
  'Paper-Trail/Invoices',
  'Paper-Trail/Admin',
  'Paper-Trail/Travel',
  'Feed',
  'Social',
  'Promotions',
  'Archive',
];

// Pattern detection signals
export const TRIAGE_PATTERNS = {
  twoFA: /verification code|security code|2fa|one-time|otp|sign.?in code/i,
  shipping: /shipped|tracking|delivery|out for delivery|package|carrier/i,
  invoice: /receipt|invoice|order confirm|payment|purchase|transaction/i,
  travel: /flight|booking|itinerary|hotel|reservation|boarding|check-in/i,
  admin: /contract|agreement|terms of service|account.*(created|updated)|policy/i,
  socialDM: /sent you a message|direct message|new message from|privately/i,
  newsletter: /unsubscribe.*newsletter|weekly digest|monthly update/i,
  promo: /% off|sale|discount|limited time|special offer|exclusive deal/i,
  dev: /github|gitlab|bitbucket|pull request|issue|commit|build|deploy/i,
};

export const SOCIAL_DOMAINS = [
  'linkedin.com', 'twitter.com', 'x.com', 'facebook.com',
  'facebookmail.com', 'instagram.com', 'reddit.com'
];

export const DEV_DOMAINS = [
  'github.com', 'gitlab.com', 'bitbucket.org', 'circleci.com',
  'travis-ci.com', 'vercel.com', 'netlify.com'
];
```

**Step 2: Commit**

```bash
git add src/core/domain.ts
git commit -m "feat(triage): add domain types for email triage

Spec: docs/designs/2025-12-16-email-triage-system.md#classification-result-type"
```

---

## Phase 3: Ports (Interfaces)

### Task 3.1: Add Triage Ports

**Files:**
- Modify: `src/core/ports.ts`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#new-port`

**Step 1: Add imports**

At top of ports.ts, add to imports:

```typescript
import type { TriageClassificationResult, TrainingExample, SenderRule, EmailSnooze, TriageLogEntry, TriageFolder } from './domain';
```

**Step 2: Add port types**

Add before `export type Deps`:

```typescript
// ============================================
// Email Triage Ports
// ============================================

export type TriageConfig = {
  enabled: boolean;
  confidenceThreshold: number;
  waitingReplyDays: number;
  twoFaAutoDeleteMinutes: number;
  promoAutoArchiveDays: number;
  devAutoDeleteDays: number;
};

export type PatternMatchResult = {
  folder: TriageFolder;
  confidence: number;
  tags: string[];
  snoozeUntil?: Date;
  autoDeleteAfter?: number;
};

export type PatternMatcher = {
  match: (email: Email) => PatternMatchResult;
};

export type TriageClassifier = {
  classify: (email: Email, patternHint: PatternMatchResult, examples: TrainingExample[]) => Promise<TriageClassificationResult>;
};

export type TrainingRepo = {
  findByAccount: (accountId: number, limit?: number) => Promise<TrainingExample[]>;
  findByDomain: (accountId: number, domain: string, limit?: number) => Promise<TrainingExample[]>;
  save: (example: Omit<TrainingExample, 'id' | 'createdAt'>) => Promise<TrainingExample>;
  getRelevantExamples: (accountId: number, email: Email, limit?: number) => Promise<TrainingExample[]>;
};

export type SenderRuleRepo = {
  findByAccount: (accountId: number) => Promise<SenderRule[]>;
  findAutoApply: (accountId: number) => Promise<SenderRule[]>;
  findByPattern: (accountId: number, pattern: string, patternType: string) => Promise<SenderRule | null>;
  upsert: (rule: Omit<SenderRule, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SenderRule>;
  incrementCount: (id: number) => Promise<void>;
};

export type SnoozeRepo = {
  findByEmail: (emailId: number) => Promise<EmailSnooze | null>;
  findDue: () => Promise<EmailSnooze[]>;
  create: (snooze: Omit<EmailSnooze, 'id' | 'createdAt'>) => Promise<EmailSnooze>;
  delete: (emailId: number) => Promise<void>;
};

export type TriageLogRepo = {
  log: (entry: Omit<TriageLogEntry, 'id' | 'createdAt'>) => Promise<void>;
  findByEmail: (emailId: number) => Promise<TriageLogEntry[]>;
  findRecent: (limit?: number, accountId?: number) => Promise<TriageLogEntry[]>;
};

export type ImapFolderOps = {
  createFolder: (account: Account, path: string) => Promise<void>;
  deleteFolder: (account: Account, path: string) => Promise<void>;
  listFolders: (account: Account) => Promise<{ path: string; specialUse?: string }[]>;
  moveMessage: (account: Account, emailUid: number, fromFolder: string, toFolder: string) => Promise<void>;
  ensureTriageFolders: (account: Account) => Promise<string[]>;
};

export type EmailTriageService = {
  classifyEmail: (email: Email) => Promise<TriageClassificationResult>;
  moveToFolder: (emailId: number, folder: TriageFolder) => Promise<void>;
  scheduleSnooze: (emailId: number, until: Date, reason: EmailSnooze['reason']) => Promise<void>;
  cancelSnooze: (emailId: number) => Promise<void>;
  processSnoozedEmails: () => Promise<number>;
  learnFromCorrection: (emailId: number, fromFolder: string, toFolder: TriageFolder) => Promise<void>;
};
```

**Step 3: Update Deps type**

Add to `Deps` type:

```typescript
  // Triage
  patternMatcher: PatternMatcher;
  triageClassifier: TriageClassifier;
  trainingRepo: TrainingRepo;
  senderRules: SenderRuleRepo;
  snoozes: SnoozeRepo;
  triageLog: TriageLogRepo;
  imapFolderOps: ImapFolderOps;
```

**Step 4: Commit**

```bash
git add src/core/ports.ts
git commit -m "feat(triage): add port interfaces for triage system

Spec: docs/designs/2025-12-16-email-triage-system.md#new-port"
```

---

## Phase 4: Pattern Matcher Adapter

### Task 4.1: Create Pattern Matcher

**Files:**
- Create: `src/adapters/triage/pattern-matcher.ts`
- Create: `src/adapters/triage/pattern-matcher.test.ts`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#detection-patterns`

**Step 1: Write failing tests**

Create `src/adapters/triage/pattern-matcher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createPatternMatcher } from './pattern-matcher';
import type { Email } from '../../core/domain';

const baseEmail: Email = {
  id: 1,
  messageId: 'test@example.com',
  accountId: 1,
  folderId: 1,
  uid: 1,
  subject: 'Test',
  from: { address: 'test@example.com', name: 'Test' },
  to: ['user@example.com'],
  date: new Date(),
  snippet: '',
  sizeBytes: 1000,
  isRead: false,
  isStarred: false,
  hasAttachments: false,
  bodyFetched: false,
};

describe('PatternMatcher', () => {
  const matcher = createPatternMatcher();

  it('detects 2FA codes', () => {
    const email = { ...baseEmail, subject: 'Your verification code is 123456' };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.autoDeleteAfter).toBe(15);
    expect(result.tags).toContain('2fa');
  });

  it('detects shipping notifications', () => {
    const email = { ...baseEmail, subject: 'Your package has shipped', from: { address: 'shipments@amazon.com', name: 'Amazon' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.tags).toContain('shipping');
  });

  it('detects invoices', () => {
    const email = { ...baseEmail, subject: 'Your receipt from Apple' };
    const result = matcher.match(email);
    expect(result.folder).toBe('Paper-Trail/Invoices');
  });

  it('detects LinkedIn DMs -> INBOX', () => {
    const email = { ...baseEmail, subject: 'John sent you a message', from: { address: 'notifications@linkedin.com', name: 'LinkedIn' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.tags).toContain('social-dm');
  });

  it('detects LinkedIn notifications -> Social', () => {
    const email = { ...baseEmail, subject: 'You appeared in 3 searches', from: { address: 'notifications@linkedin.com', name: 'LinkedIn' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('Social');
  });

  it('detects newsletters', () => {
    const email = { ...baseEmail, subject: 'Weekly digest from Substack' };
    const result = matcher.match(email);
    expect(result.folder).toBe('Feed');
  });

  it('detects promotions', () => {
    const email = { ...baseEmail, subject: '50% off this weekend only!' };
    const result = matcher.match(email);
    expect(result.folder).toBe('Promotions');
  });

  it('defaults to INBOX for unknown patterns', () => {
    const email = { ...baseEmail, subject: 'Meeting tomorrow', from: { address: 'boss@company.com', name: 'Boss' } };
    const result = matcher.match(email);
    expect(result.folder).toBe('INBOX');
    expect(result.confidence).toBeLessThan(0.5);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- src/adapters/triage/pattern-matcher.test.ts
```

Expected: FAIL - module not found

**Step 3: Implement pattern matcher**

Create `src/adapters/triage/pattern-matcher.ts`:

```typescript
import type { PatternMatcher, PatternMatchResult } from '../../core/ports';
import type { Email, TriageFolder } from '../../core/domain';
import { TRIAGE_PATTERNS, SOCIAL_DOMAINS, DEV_DOMAINS } from '../../core/domain';

export function createPatternMatcher(): PatternMatcher {
  return {
    match(email: Email): PatternMatchResult {
      const subject = email.subject.toLowerCase();
      const fromDomain = extractDomain(email.from.address);
      const text = `${email.subject} ${email.from.address}`.toLowerCase();

      const tags: string[] = [];
      let folder: TriageFolder = 'INBOX';
      let confidence = 0.3;
      let snoozeUntil: Date | undefined;
      let autoDeleteAfter: number | undefined;

      // 2FA codes - highest priority
      if (TRIAGE_PATTERNS.twoFA.test(text)) {
        tags.push('2fa');
        folder = 'INBOX';
        confidence = 0.95;
        autoDeleteAfter = 15; // minutes
        return { folder, confidence, tags, autoDeleteAfter };
      }

      // Social DMs vs regular social notifications
      if (isSocialDomain(fromDomain)) {
        if (TRIAGE_PATTERNS.socialDM.test(text)) {
          tags.push('social-dm');
          folder = 'INBOX';
          confidence = 0.9;
        } else {
          tags.push('social');
          folder = 'Social';
          confidence = 0.85;
        }
        return { folder, confidence, tags };
      }

      // Dev notifications
      if (isDevDomain(fromDomain)) {
        tags.push('dev');
        folder = 'INBOX';
        confidence = 0.8;
        autoDeleteAfter = 30 * 24 * 60; // 30 days in minutes
        return { folder, confidence, tags, autoDeleteAfter };
      }

      // Shipping
      if (TRIAGE_PATTERNS.shipping.test(text)) {
        tags.push('shipping');
        folder = 'INBOX';
        confidence = 0.85;
        // TODO: Extract delivery date for snooze
        snoozeUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days fallback
        return { folder, confidence, tags, snoozeUntil };
      }

      // Invoices/Receipts
      if (TRIAGE_PATTERNS.invoice.test(text)) {
        tags.push('invoice');
        folder = 'Paper-Trail/Invoices';
        confidence = 0.85;
        return { folder, confidence, tags };
      }

      // Travel
      if (TRIAGE_PATTERNS.travel.test(text)) {
        tags.push('travel');
        folder = 'Paper-Trail/Travel';
        confidence = 0.85;
        return { folder, confidence, tags };
      }

      // Admin/Contracts
      if (TRIAGE_PATTERNS.admin.test(text)) {
        tags.push('admin');
        folder = 'Paper-Trail/Admin';
        confidence = 0.75;
        return { folder, confidence, tags };
      }

      // Newsletters
      if (TRIAGE_PATTERNS.newsletter.test(text)) {
        tags.push('newsletter');
        folder = 'Feed';
        confidence = 0.85;
        return { folder, confidence, tags };
      }

      // Promotions
      if (TRIAGE_PATTERNS.promo.test(text)) {
        tags.push('promo');
        folder = 'Promotions';
        confidence = 0.8;
        autoDeleteAfter = 7 * 24 * 60; // 7 days
        return { folder, confidence, tags, autoDeleteAfter };
      }

      // No pattern matched - default to INBOX with low confidence
      return { folder, confidence, tags };
    },
  };
}

function extractDomain(email: string): string {
  const match = email.match(/@([^>]+)/);
  return match ? match[1].toLowerCase() : '';
}

function isSocialDomain(domain: string): boolean {
  return SOCIAL_DOMAINS.some(d => domain.includes(d));
}

function isDevDomain(domain: string): boolean {
  return DEV_DOMAINS.some(d => domain.includes(d));
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- src/adapters/triage/pattern-matcher.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/adapters/triage/
git commit -m "feat(triage): implement pattern matcher for email classification

Spec: docs/designs/2025-12-16-email-triage-system.md#detection-patterns"
```

---

## Phase 5: Triage Repository Adapters

### Task 5.1: Create Training Repository

**Files:**
- Create: `src/adapters/triage/training-repo.ts`
- Create: `src/adapters/triage/training-repo.test.ts`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#training-data-schema`

**Step 1: Write failing test**

```typescript
// src/adapters/triage/training-repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTrainingRepo } from './training-repo';

describe('TrainingRepo', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createTrainingRepo>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE training_examples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        email_id INTEGER,
        from_address TEXT NOT NULL,
        from_domain TEXT NOT NULL,
        subject TEXT NOT NULL,
        ai_suggestion TEXT,
        user_choice TEXT NOT NULL,
        was_correction INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    repo = createTrainingRepo(() => db);
  });

  it('saves and retrieves training examples', async () => {
    const example = await repo.save({
      accountId: 1,
      emailId: 100,
      fromAddress: 'test@amazon.com',
      fromDomain: 'amazon.com',
      subject: 'Your order shipped',
      aiSuggestion: 'INBOX',
      userChoice: 'INBOX',
      wasCorrection: false,
      source: 'onboarding',
    });

    expect(example.id).toBeDefined();

    const results = await repo.findByAccount(1);
    expect(results).toHaveLength(1);
    expect(results[0].fromDomain).toBe('amazon.com');
  });

  it('finds examples by domain', async () => {
    await repo.save({
      accountId: 1, emailId: 1, fromAddress: 'a@amazon.com', fromDomain: 'amazon.com',
      subject: 'Order 1', aiSuggestion: null, userChoice: 'INBOX', wasCorrection: false, source: 'onboarding',
    });
    await repo.save({
      accountId: 1, emailId: 2, fromAddress: 'b@linkedin.com', fromDomain: 'linkedin.com',
      subject: 'Connection', aiSuggestion: null, userChoice: 'Social', wasCorrection: false, source: 'onboarding',
    });

    const amazonExamples = await repo.findByDomain(1, 'amazon.com');
    expect(amazonExamples).toHaveLength(1);
    expect(amazonExamples[0].fromAddress).toBe('a@amazon.com');
  });
});
```

**Step 2: Run test - expect fail**

```bash
npm test -- src/adapters/triage/training-repo.test.ts
```

**Step 3: Implement**

```typescript
// src/adapters/triage/training-repo.ts
import type Database from 'better-sqlite3';
import type { TrainingRepo } from '../../core/ports';
import type { TrainingExample, Email } from '../../core/domain';

export function createTrainingRepo(getDb: () => Database.Database): TrainingRepo {
  return {
    async findByAccount(accountId: number, limit = 50): Promise<TrainingExample[]> {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM training_examples
        WHERE account_id = ?
        ORDER BY was_correction DESC, created_at DESC
        LIMIT ?
      `).all(accountId, limit) as any[];
      return rows.map(mapRow);
    },

    async findByDomain(accountId: number, domain: string, limit = 10): Promise<TrainingExample[]> {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM training_examples
        WHERE account_id = ? AND from_domain = ?
        ORDER BY was_correction DESC, created_at DESC
        LIMIT ?
      `).all(accountId, domain, limit) as any[];
      return rows.map(mapRow);
    },

    async save(example: Omit<TrainingExample, 'id' | 'createdAt'>): Promise<TrainingExample> {
      const db = getDb();
      const result = db.prepare(`
        INSERT INTO training_examples (account_id, email_id, from_address, from_domain, subject, ai_suggestion, user_choice, was_correction, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        example.accountId,
        example.emailId,
        example.fromAddress,
        example.fromDomain,
        example.subject,
        example.aiSuggestion,
        example.userChoice,
        example.wasCorrection ? 1 : 0,
        example.source
      );
      return {
        ...example,
        id: result.lastInsertRowid as number,
        createdAt: new Date(),
      };
    },

    async getRelevantExamples(accountId: number, email: Email, limit = 10): Promise<TrainingExample[]> {
      const db = getDb();
      const domain = email.from.address.split('@')[1] || '';

      // Prioritize: same domain corrections > same domain confirmations > other corrections
      const rows = db.prepare(`
        SELECT *,
          CASE
            WHEN from_domain = ? AND was_correction = 1 THEN 3
            WHEN from_domain = ? AND was_correction = 0 THEN 2
            WHEN was_correction = 1 THEN 1
            ELSE 0
          END as relevance
        FROM training_examples
        WHERE account_id = ?
        ORDER BY relevance DESC, created_at DESC
        LIMIT ?
      `).all(domain, domain, accountId, limit) as any[];

      return rows.map(mapRow);
    },
  };
}

function mapRow(row: any): TrainingExample {
  return {
    id: row.id,
    accountId: row.account_id,
    emailId: row.email_id,
    fromAddress: row.from_address,
    fromDomain: row.from_domain,
    subject: row.subject,
    aiSuggestion: row.ai_suggestion,
    userChoice: row.user_choice,
    wasCorrection: Boolean(row.was_correction),
    source: row.source as TrainingExample['source'],
    createdAt: new Date(row.created_at),
  };
}
```

**Step 4: Run test - expect pass**

```bash
npm test -- src/adapters/triage/training-repo.test.ts
```

**Step 5: Commit**

```bash
git add src/adapters/triage/training-repo.ts src/adapters/triage/training-repo.test.ts
git commit -m "feat(triage): implement training examples repository

Spec: docs/designs/2025-12-16-email-triage-system.md#training-data-schema"
```

---

### Task 5.2: Create Sender Rules Repository

**Files:**
- Create: `src/adapters/triage/sender-rules-repo.ts`
- Create: `src/adapters/triage/sender-rules-repo.test.ts`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#sender-rules-auto-generated`

**Step 1: Write test**

```typescript
// src/adapters/triage/sender-rules-repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createSenderRulesRepo } from './sender-rules-repo';

describe('SenderRulesRepo', () => {
  let db: Database.Database;
  let repo: ReturnType<typeof createSenderRulesRepo>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE sender_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        pattern TEXT NOT NULL,
        pattern_type TEXT NOT NULL DEFAULT 'domain',
        target_folder TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        correction_count INTEGER NOT NULL DEFAULT 1,
        auto_apply INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(account_id, pattern, pattern_type)
      )
    `);
    repo = createSenderRulesRepo(() => db);
  });

  it('creates and updates rules via upsert', async () => {
    const rule = await repo.upsert({
      accountId: 1,
      pattern: 'amazon.com',
      patternType: 'domain',
      targetFolder: 'Paper-Trail/Invoices',
      confidence: 0.8,
      correctionCount: 1,
      autoApply: false,
    });

    expect(rule.id).toBeDefined();

    // Update same pattern
    const updated = await repo.upsert({
      accountId: 1,
      pattern: 'amazon.com',
      patternType: 'domain',
      targetFolder: 'Paper-Trail/Invoices',
      confidence: 0.9,
      correctionCount: 3,
      autoApply: true,
    });

    expect(updated.id).toBe(rule.id);
    expect(updated.autoApply).toBe(true);
  });

  it('finds auto-apply rules', async () => {
    await repo.upsert({ accountId: 1, pattern: 'a.com', patternType: 'domain', targetFolder: 'INBOX', confidence: 0.9, correctionCount: 5, autoApply: true });
    await repo.upsert({ accountId: 1, pattern: 'b.com', patternType: 'domain', targetFolder: 'INBOX', confidence: 0.7, correctionCount: 2, autoApply: false });

    const autoRules = await repo.findAutoApply(1);
    expect(autoRules).toHaveLength(1);
    expect(autoRules[0].pattern).toBe('a.com');
  });
});
```

**Step 2-5: Implement, run tests, commit** (follow same pattern as Task 5.1)

---

### Task 5.3: Create Snooze Repository

Similar pattern - create `src/adapters/triage/snooze-repo.ts` and test.

### Task 5.4: Create Triage Log Repository

Similar pattern - create `src/adapters/triage/triage-log-repo.ts` and test.

### Task 5.5: Create Index File

**Files:**
- Create: `src/adapters/triage/index.ts`

```typescript
export { createPatternMatcher } from './pattern-matcher';
export { createTrainingRepo } from './training-repo';
export { createSenderRulesRepo } from './sender-rules-repo';
export { createSnoozeRepo } from './snooze-repo';
export { createTriageLogRepo } from './triage-log-repo';
```

---

## Phase 6: IMAP Folder Operations

### Task 6.1: Add Folder Operations to IMAP Adapter

**Files:**
- Modify: `src/adapters/imap/index.ts`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#folder-creation-first-run`

**Step 1: Add folder operations**

Add to `createMailSync` return object:

```typescript
async createFolder(account: Account, path: string): Promise<void> {
  const client = await getConnection(account);
  await client.mailboxCreate(path);
},

async moveMessage(account: Account, emailUid: number, fromFolder: string, toFolder: string): Promise<void> {
  const client = await getConnection(account);
  await client.mailboxOpen(fromFolder);
  await client.messageMove(emailUid.toString(), toFolder);
},

async ensureTriageFolders(account: Account): Promise<string[]> {
  const TRIAGE_FOLDERS = [
    'Planning',
    'Review',
    'Paper-Trail',
    'Paper-Trail/Invoices',
    'Paper-Trail/Admin',
    'Paper-Trail/Travel',
    'Feed',
    'Social',
    'Promotions',
    'Archive',
  ];

  const client = await getConnection(account);
  const existing = await client.list();
  const existingPaths = new Set(existing.map(f => f.path));
  const created: string[] = [];

  for (const folder of TRIAGE_FOLDERS) {
    if (!existingPaths.has(folder)) {
      try {
        await client.mailboxCreate(folder);
        created.push(folder);
      } catch (e) {
        // Folder might already exist or parent needs creating
        console.warn(`Failed to create folder ${folder}:`, e);
      }
    }
  }

  return created;
},
```

---

## Phase 7: Triage Classifier (LLM)

### Task 7.1: Create Triage Classifier Adapter

**Files:**
- Create: `src/adapters/triage/triage-classifier.ts`
- Create: `src/adapters/triage/triage-classifier.test.ts`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#llm-prompt-design`

**Step 1: Write test**

```typescript
// Mock test - real LLM calls would be integration tests
import { describe, it, expect, vi } from 'vitest';
import { createTriageClassifier, buildTriagePrompt } from './triage-classifier';

describe('TriageClassifier', () => {
  describe('buildTriagePrompt', () => {
    it('includes pattern hint in prompt', () => {
      const prompt = buildTriagePrompt(
        { from: { address: 'test@amazon.com' }, subject: 'Your order shipped' } as any,
        { folder: 'INBOX', confidence: 0.85, tags: ['shipping'] },
        []
      );

      expect(prompt).toContain('INBOX');
      expect(prompt).toContain('0.85');
      expect(prompt).toContain('shipping');
    });

    it('includes training examples', () => {
      const examples = [
        { fromDomain: 'amazon.com', userChoice: 'INBOX', wasCorrection: false, aiSuggestion: 'INBOX' },
      ];

      const prompt = buildTriagePrompt(
        { from: { address: 'test@amazon.com' }, subject: 'Test' } as any,
        { folder: 'INBOX', confidence: 0.5, tags: [] },
        examples as any[]
      );

      expect(prompt).toContain('amazon.com');
      expect(prompt).toContain('INBOX');
    });
  });
});
```

**Step 2: Implement**

```typescript
// src/adapters/triage/triage-classifier.ts
import type { TriageClassifier, PatternMatchResult } from '../../core/ports';
import type { Email, TrainingExample, TriageClassificationResult, TriageFolder } from '../../core/domain';

const TRIAGE_PROMPT = `You are an email triage assistant. Classify this email into ONE folder.

FOLDERS:
- INBOX: Urgent, actionable, important, requires response today
- Planning: Medium-term, "when you have time", no hard deadline
- Paper-Trail/Invoices: Receipts, invoices, payment confirmations
- Paper-Trail/Admin: Contracts, account info, legal, support tickets
- Paper-Trail/Travel: Flight/hotel bookings, itineraries
- Feed: Newsletters, curated content you want to read
- Social: Social media notifications (NOT direct messages)
- Promotions: Marketing, sales, discounts

NOTE: If confidence < 0.7, email goes to /Review folder for user triage.
Be honest about your confidence - uncertain classifications help the user.

SPECIAL RULES:
- Direct messages from social platforms → INBOX (human conversation)
- CC'd with no action required → Planning
- 2FA/security codes → INBOX (mark for auto-delete)
- Shipping updates → INBOX (mark for snooze until delivery)`;

export function buildTriagePrompt(
  email: Email,
  patternHint: PatternMatchResult,
  examples: TrainingExample[]
): string {
  let prompt = TRIAGE_PROMPT;

  // Add pattern hint
  prompt += `\n\nPATTERN MATCHING HINT:
Our pattern matcher suggests: ${patternHint.folder} (confidence: ${patternHint.confidence.toFixed(2)})
Detected patterns: ${patternHint.tags.join(', ') || 'none'}

Your job: VALIDATE or OVERRIDE this suggestion based on email content and context.
- If pattern seems correct, confirm it with your reasoning
- If pattern missed context (spam disguised as invoice, etc.), override it
- You are the final authority`;

  // Add training examples
  if (examples.length > 0) {
    prompt += `\n\nUSER PREFERENCES (from training):`;
    for (const ex of examples) {
      if (ex.wasCorrection) {
        prompt += `\n• ${ex.fromDomain}: AI suggested ${ex.aiSuggestion}, user corrected to ${ex.userChoice}`;
      } else {
        prompt += `\n• ${ex.fromDomain}: ${ex.userChoice} ✓`;
      }
    }
  }

  // Add email details
  prompt += `\n\nEMAIL:
From: ${email.from.name || ''} <${email.from.address}>
Subject: ${email.subject}
Date: ${email.date.toISOString()}

Respond with JSON only:
{
  "folder": "...",
  "tags": ["...", "..."],
  "confidence": 0.0-1.0,
  "snoozeUntil": "ISO date or null",
  "autoDeleteMinutes": number or null,
  "patternAgreed": true/false,
  "reasoning": "brief explanation"
}`;

  return prompt;
}

type LLMClient = {
  complete: (prompt: string) => Promise<string>;
};

export function createTriageClassifier(llmClient: LLMClient): TriageClassifier {
  return {
    async classify(
      email: Email,
      patternHint: PatternMatchResult,
      examples: TrainingExample[]
    ): Promise<TriageClassificationResult> {
      const prompt = buildTriagePrompt(email, patternHint, examples);

      try {
        const response = await llmClient.complete(prompt);
        const parsed = JSON.parse(response);

        return {
          folder: parsed.folder as TriageFolder,
          tags: parsed.tags || [],
          confidence: parsed.confidence,
          snoozeUntil: parsed.snoozeUntil ? new Date(parsed.snoozeUntil) : undefined,
          autoDeleteAfter: parsed.autoDeleteMinutes,
          patternHint: patternHint.folder,
          patternAgreed: parsed.patternAgreed,
          reasoning: parsed.reasoning,
        };
      } catch (error) {
        // LLM failed - return pattern hint with low confidence
        return {
          folder: 'Review',
          tags: patternHint.tags,
          confidence: 0,
          patternHint: patternHint.folder,
          patternAgreed: false,
          reasoning: `LLM error: ${error instanceof Error ? error.message : 'unknown'}`,
        };
      }
    },
  };
}
```

---

## Phase 8: Use Cases

### Task 8.1: Add Triage Use Cases

**Files:**
- Modify: `src/core/usecases.ts`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#classification-flow-with-learning`

Add new use cases for:
- `triageEmail` - Main classification flow
- `ensureTriageFolders` - Setup folders on account creation
- `learnFromCorrection` - Update training when user moves email
- `processSnoozedEmails` - Background job for snooze resurfacing
- `selectDiverseTrainingEmails` - Curated selection for onboarding

---

## Phase 9: IPC Handlers

### Task 9.1: Add Triage IPC Handlers

**Files:**
- Modify: `src/main/ipc.ts`

Add handlers for:
- `triage:classify`
- `triage:move`
- `triage:learn`
- `triage:training-emails`
- `triage:confirm-training`
- `triage:skip-training`

---

## Phase 10: Container Wiring

### Task 10.1: Wire Triage Adapters

**Files:**
- Modify: `src/main/container.ts`

Wire all new adapters into the dependency container.

---

## Phase 11: Onboarding UI

### Task 11.1: Create Training Step Component

**Files:**
- Create: `src/renderer/components/onboarding/TrainingStep.tsx`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#training-ui`

### Task 11.2: Add to Onboarding Flow

**Files:**
- Modify: `src/renderer/components/onboarding/index.tsx`

---

## Phase 12: Sidebar Updates

### Task 12.1: Update Sidebar with Triage Folders

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`

**Spec Reference:** `docs/designs/2025-12-16-email-triage-system.md#sidebar-folders`

---

## Phase 13: Integration & Testing

### Task 13.1: Integration Tests

Create integration tests for full triage flow.

### Task 13.2: Manual Testing Checklist

- [ ] New account creates triage folders
- [ ] Training step shows 12 diverse emails
- [ ] Pattern matching detects 2FA, shipping, invoices
- [ ] LLM validates/overrides pattern decisions
- [ ] Low confidence emails go to Review folder
- [ ] User corrections update sender rules
- [ ] Snoozed emails resurface on schedule
- [ ] Folders sync to other email clients

---

## Summary

| Phase | Tasks | Est. LOC |
|-------|-------|----------|
| 1. Schema | 1 | 80 |
| 2. Domain | 1 | 100 |
| 3. Ports | 1 | 120 |
| 4. Pattern Matcher | 1 | 200 |
| 5. Repositories | 5 | 400 |
| 6. IMAP Ops | 1 | 80 |
| 7. LLM Classifier | 1 | 150 |
| 8. Use Cases | 1 | 300 |
| 9. IPC | 1 | 100 |
| 10. Container | 1 | 50 |
| 11. Onboarding UI | 2 | 300 |
| 12. Sidebar | 1 | 100 |
| 13. Testing | 2 | 200 |

**Total: ~2000 LOC across 19 tasks**
