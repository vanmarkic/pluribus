# Email Triage System Design

**Date:** 2025-12-16
**Status:** Partially Implemented

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| IMAP folder operations | ✅ Done | `src/adapters/imap/index.ts` - createFolder, moveMessage, ensureTriageFolders |
| Pattern matching | ✅ Done | `src/adapters/triage/pattern-matcher.ts` |
| LLM triage classifier | ✅ Done | `src/adapters/triage/triage-classifier.ts` |
| Training examples DB | ✅ Done | `src/adapters/db/triage-repos.ts` |
| Triage log | ✅ Done | `src/adapters/db/triage-repos.ts` |
| triageAndMoveEmail use case | ✅ Done | Classifies + moves email to IMAP folder + updates local DB |
| Sync integration | ✅ Done | `syncWithAutoClassify` ensures folders exist before classification |
| Onboarding TrainingStep | ✅ Done | `src/renderer/components/onboarding/TrainingStep.tsx` |
| Local DB folder sync | ✅ Done | `setFolderId` updates local DB after IMAP move (Issue #53) |
| Stats/list consistency | ✅ Done | Issue #52 - pendingReview count matches listPendingReview |
| Snooze system | ✅ Done | `snoozeEmail`, `processSnoozedEmails` use cases |
| Auto-delete scheduler | ⏳ TODO | Not yet implemented |
| Sender rules learning | ⏳ TODO | Schema exists, no use cases yet |
| Review folder UI | ⏳ TODO | Low-confidence emails need dedicated UI |

## Summary

Hybrid folder-based triage system that works universally across all IMAP providers (Gmail, Proton, Infomaniak, etc.). Uses IMAP folders for server-synced organization + local SQLite tags for Pluribus-specific metadata.

**Key insight:** IMAP folders sync everywhere, IMAP keywords don't. Design around folders.

## Decisions

| Aspect | Decision |
|--------|----------|
| Primary organization | IMAP folders (syncs across all clients) |
| Secondary tags | Local SQLite only (Pluribus-specific) |
| Inbox philosophy | Curated: only actionable/important items |
| Classification | Pattern matching → LLM validation (always both) |
| LLM role | Final authority - validates/overrides all pattern decisions |
| LLM provider | Local (Ollama) 99% of time - no cost/privacy concerns |
| Low confidence | Dedicated /Review folder for user triage |
| Snooze | Local implementation with resurface triggers |
| Auto-cleanup | 2FA (15 min), Promotions (7 days), Dev notifications (30 days) |

## Folder Structure

```
/Inbox                      ← Urgent, actionable, direct
/Planning                   ← Medium-term, think-about-later
/Review                     ← Low-confidence (needs user triage)
/Paper-Trail
    /Invoices               ← Financial (receipts, orders, payments)
    /Admin                  ← Contracts, accounts, legal
    /Travel                 ← Flights, hotels, itineraries
/Feed                       ← Newsletters, curated reads
/Social                     ← Non-DM notifications
/Promotions                 ← Marketing (auto-archive 7 days)
/Archive                    ← Processed emails

+ Standard IMAP: /Sent, /Drafts, /Trash
```

**Total:** 8 custom folders + 3 standard IMAP = 11 folders

## Classification Rules

### Inbox (Actionable)

| Email Type | Detection | Special Behavior |
|------------|-----------|------------------|
| VIP sender | Contact list / frequency | — |
| Direct question | LLM: question directed at user | — |
| Deadline / Time-sensitive | LLM: dates, "urgent", "asap" | — |
| Bank alerts (urgent) | Sender domain + keywords | — |
| Calendar invites | MIME type / subject patterns | — |
| Social DMs | "sent you a message" pattern | — |
| GitHub/Dev notifications | Sender domain | Auto-delete 30 days |
| Shipping | Tracking patterns | Snooze until delivery |
| 2FA / Security codes | OTP patterns | Auto-delete 15 min |
| CC'd (actionable) | LLM determines action needed | — |

### Planning (Medium-term)

| Email Type | Detection |
|------------|-----------|
| "When you have time..." | LLM: no hard deadline |
| Project ideas, proposals | LLM: discussion, not action |
| CC'd (FYI only) | CC recipient + LLM: no action needed |
| Mailing list (discussion) | LLM: based on content |

### Paper-Trail

| Subfolder | Detection Patterns |
|-----------|-------------------|
| **Invoices** | `receipt`, `invoice`, `order confirm`, `payment`, `purchase` |
| **Admin** | `contract`, `account`, `legal`, `terms`, `policy`, `ticket` |
| **Travel** | `flight`, `booking`, `itinerary`, `hotel`, `reservation`, `boarding` |

### Feed

| Email Type | Detection |
|------------|-----------|
| Newsletters | `unsubscribe.*newsletter`, `weekly digest`, sender patterns |
| News alerts | Google Alerts, RSS digests |
| Curated content | Known newsletter domains |

### Social

| Email Type | Detection | Override |
|------------|-----------|----------|
| LinkedIn notifications | `linkedin.com` sender | DM → Inbox |
| Twitter/X notifications | `twitter.com`, `x.com` | DM → Inbox |
| Facebook notifications | `facebookmail.com` | Messenger → Inbox |
| GitHub notifications | `github.com` | PR reviews → Inbox |
| Other social | Social platform domains | DM → Inbox |

### Promotions

| Email Type | Detection |
|------------|-----------|
| Marketing emails | `% off`, `sale`, `discount`, `limited time`, `special offer` |
| Promo newsletters | `unsubscribe` + promotional content |

## Smart Behaviors

### 1. Waiting-for-Reply Tracking

```
You send email
      │
      ▼
Auto-snooze 3 days (configurable)
      │
      ▼
No reply received?
      │
      ├─ Yes → Resurface in Inbox with "Waiting" badge
      │
      └─ Reply received → Cancel snooze
```

**Implementation:**
- Track sent emails in SQLite with `expecting_reply` flag
- Background job checks for replies by thread ID
- Snooze duration configurable in settings

### 2. Shipping Snooze

```
Shipping email arrives
      │
      ▼
LLM extracts delivery date
      │
      ├─ Date found → Snooze until delivery day
      │
      └─ No date → Snooze 3 days (fallback)
      │
      ▼
Resurface on delivery day
```

### 3. Auto-Cleanup Rules

| Email Type | Action | Timing |
|------------|--------|--------|
| 2FA codes | Delete | 15 minutes after arrival |
| Promotions | Move to Archive | 7 days after arrival |
| Dev notifications | Delete | 30 days after arrival |
| Shipping (delivered) | Move to Archive | 3 days after delivery |

### 4. CC Priority Demotion

```
Email received where user is CC'd
      │
      ▼
LLM analyzes: Is action required?
      │
      ├─ Yes → Inbox (treat as direct)
      │
      └─ No → Planning (FYI only)
```

### 5. Low-Confidence → Review Folder

```
Classification complete
      │
      ▼
Confidence < threshold (default: 0.7)?
      │
      ├─ Yes → Move to /Review folder
      │        • Keeps suggested folder as metadata
      │        • User manually triages later
      │
      └─ No → Move to suggested folder
```

**Review folder behavior:**
- Emails land here when LLM is uncertain
- Shows suggested folder + reasoning in UI
- User can: Accept suggestion, Pick different folder, or Dismiss
- User corrections stored for future prompt context

### 6. Social DM Override

```
Social notification email
      │
      ▼
Is it a direct/private message?
      │
      ├─ Yes → Inbox (human conversation)
      │
      └─ No → Social folder
```

## Detection Patterns

```typescript
const patterns = {
  // Immediate action
  twoFA: /verification code|security code|2fa|one-time|otp|sign.?in code/i,

  // Paper trail
  shipping: /shipped|tracking|delivery|out for delivery|package|carrier/i,
  invoice: /receipt|invoice|order confirm|payment|purchase|transaction/i,
  travel: /flight|booking|itinerary|hotel|reservation|boarding|check-in/i,
  admin: /contract|agreement|terms of service|account.*(created|updated)|policy/i,

  // Social
  socialDM: /sent you a message|direct message|new message from|privately/i,

  // Content types
  newsletter: /unsubscribe.*newsletter|weekly digest|monthly update/i,
  promo: /% off|sale|discount|limited time|special offer|exclusive deal/i,

  // Dev
  dev: /github|gitlab|bitbucket|pull request|issue|commit|build|deploy/i,
};

const socialDomains = [
  'linkedin.com', 'twitter.com', 'x.com', 'facebook.com',
  'facebookmail.com', 'instagram.com', 'reddit.com'
];

const devDomains = [
  'github.com', 'gitlab.com', 'bitbucket.org', 'circleci.com',
  'travis-ci.com', 'vercel.com', 'netlify.com'
];
```

## Architecture

### Data Flow

```
Email arrives (IMAP IDLE / sync)
         │
         ▼
┌─────────────────────────────────────────────────────┐
│              Classification Engine                   │
│                                                      │
│  PHASE 1: Pattern Matching (fast, free)             │
│  ┌─────────────────────────────────────────────┐    │
│  │  • Regex patterns (2FA, shipping, invoice)  │    │
│  │  • Domain matching (social, dev, promo)     │    │
│  │  • Returns: hint folder + confidence        │    │
│  └──────────────────────┬──────────────────────┘    │
│                         │                           │
│                         ▼                           │
│  PHASE 2: LLM Validation (always runs)              │
│  ┌─────────────────────────────────────────────┐    │
│  │  • Receives pattern hint as context         │    │
│  │  • Validates or overrides pattern decision  │    │
│  │  • Adds reasoning, refines tags             │    │
│  │  • Final authority on classification        │    │
│  └──────────────────────┬──────────────────────┘    │
│                         │                           │
│                         ▼                           │
│  PHASE 3: Merge Results                             │
│  ┌─────────────────────────────────────────────┐    │
│  │  • LLM folder decision (final)              │    │
│  │  • Pattern metadata (snooze, auto-delete)   │    │
│  │  • Combined confidence                      │    │
│  └──────────────────────┬──────────────────────┘    │
└─────────────────────────┼───────────────────────────┘
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
       ┌─────────────────┐  ┌─────────────────┐
       │   IMAP MOVE     │  │  SQLite Tags    │
       │  (server-side)  │  │  (local-only)   │
       └─────────────────┘  └─────────────────┘
```

**Why LLM validates everything:**
- Pattern matching catches obvious cases but can't understand context
- "Invoice" in subject might be spam, not a real invoice
- CC'd email patterns can't determine if action is needed
- LLM provides nuanced understanding + consistent reasoning

### Classification Result Type

```typescript
type ClassificationResult = {
  // Primary: determines IMAP folder
  folder:
    | 'INBOX'
    | 'Planning'
    | 'Review'              // Low-confidence, needs user triage
    | 'Paper-Trail/Invoices'
    | 'Paper-Trail/Admin'
    | 'Paper-Trail/Travel'
    | 'Feed'
    | 'Social'
    | 'Promotions';

  // Secondary: local tags (SQLite)
  tags: string[];

  // Confidence for review queue
  confidence: number;

  // Special behaviors
  snoozeUntil?: Date;
  autoDeleteAfter?: number; // minutes

  // LLM validation metadata
  patternHint?: string;           // What pattern matcher suggested
  patternAgreed: boolean;         // Did LLM agree with pattern?
  reasoning: string;              // LLM explanation (required)
};
```

### New Port

```typescript
// core/ports.ts
export type EmailTriagePort = {
  classifyEmail: (email: Email) => Promise<ClassificationResult>;
  moveToFolder: (emailId: number, folder: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  listFolders: () => Promise<string[]>;
  scheduleSnooze: (emailId: number, until: Date) => Promise<void>;
  scheduleAutoDelete: (emailId: number, afterMinutes: number) => Promise<void>;
};
```

### New Adapter

```typescript
// adapters/triage/index.ts
export function createTriageAdapter(deps: {
  imap: ImapPort;
  llm: LLMPort;
  db: Database;
}): EmailTriagePort {
  return {
    async classifyEmail(email) {
      // 1. Pattern matching as initial hint (fast, no API cost)
      const patternHint = matchPatterns(email);

      // 2. LLM validates/refines ALL classifications
      // Pattern hint provides context, LLM makes final decision
      const llmResult = await deps.llm.classifyForTriage(email, {
        patternHint: patternHint.folder,
        patternConfidence: patternHint.confidence,
        patternTags: patternHint.tags,
      });

      // 3. Merge results: LLM decision + pattern-detected metadata
      return {
        ...llmResult,
        // Keep pattern-detected special behaviors if LLM agrees
        snoozeUntil: llmResult.snoozeUntil ?? patternHint.snoozeUntil,
        autoDeleteAfter: llmResult.autoDeleteAfter ?? patternHint.autoDeleteAfter,
      };
    },

    async moveToFolder(emailId, folder) {
      // IMAP MOVE command
      await deps.imap.moveMessage(emailId, folder);
    },

    // ... other methods
  };
}
```

## Database Schema Extensions

```sql
-- Track snoozes
CREATE TABLE email_snoozes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id),
  snooze_until DATETIME NOT NULL,
  original_folder TEXT NOT NULL,
  reason TEXT,  -- 'shipping', 'waiting_reply', 'manual'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Track auto-delete schedules
CREATE TABLE email_auto_deletes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id),
  delete_after DATETIME NOT NULL,
  reason TEXT,  -- '2fa', 'promo', 'dev'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Track sent emails for waiting-for-reply
CREATE TABLE sent_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id INTEGER REFERENCES emails(id),
  thread_id TEXT,
  expecting_reply BOOLEAN DEFAULT true,
  snooze_until DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## LLM Prompt Design

```typescript
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
- Shipping updates → INBOX (mark for snooze until delivery)

PATTERN MATCHING HINT:
Our pattern matcher suggests: {patternHint.folder} (confidence: {patternHint.confidence})
Detected patterns: {patternHint.tags}

Your job: VALIDATE or OVERRIDE this suggestion based on email content and context.
- If pattern seems correct, confirm it with your reasoning
- If pattern missed context (spam disguised as invoice, etc.), override it
- You are the final authority

EMAIL:
From: {from}
To: {to}
CC: {cc}
Subject: {subject}
Date: {date}
Body preview: {bodyPreview}

Respond with JSON:
{
  "folder": "...",
  "tags": ["...", "..."],
  "confidence": 0.0-1.0,
  "snoozeUntil": "ISO date or null",
  "autoDeleteMinutes": number or null,
  "patternAgreed": true/false,
  "reasoning": "brief explanation, note if you disagreed with pattern and why"
}`;
```

## Folder Creation (First Run)

On first account setup, create the folder structure:

```typescript
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

async function ensureTriageFolders(imap: ImapPort): Promise<void> {
  const existing = await imap.listFolders();

  for (const folder of TRIAGE_FOLDERS) {
    if (!existing.includes(folder)) {
      await imap.createFolder(folder);
    }
  }
}
```

## Settings

### User-Configurable Options

| Setting | Default | Options |
|---------|---------|---------|
| Auto-triage enabled | true | true/false |
| Waiting-reply snooze | 3 days | 1/2/3/5/7 days |
| 2FA auto-delete | 15 min | 5/10/15/30 min, never |
| Promo auto-archive | 7 days | 3/7/14/30 days, never |
| Dev notif auto-delete | 30 days | 7/14/30/60 days, never |
| LLM confidence threshold | 0.7 | 0.5-0.9 |

### VIP Senders

User can define VIP senders that always go to Inbox:
- Specific addresses
- Domains
- Contact groups

## UI Changes

### Sidebar Folders

```
📥 Inbox (12)
📤 Sent
📝 Drafts
─────────────────
👀 Review (3)           ← Low-confidence, needs triage
📋 Planning (5)
📁 Paper-Trail
   ├── 💰 Invoices
   ├── 📄 Admin
   └── ✈️ Travel
📰 Feed (23)
👥 Social (8)
🏷️ Promotions
📦 Archive
🗑️ Trash
```

### Snooze Indicator

Snoozed emails show in Inbox with visual indicator:
```
😴 [Delivery Dec 18] Amazon - Your package is on the way
⏰ [3 days] RE: Project proposal - waiting for reply
```

### Auto-Delete Warning

2FA emails show countdown:
```
🔐 [Expires in 12 min] Your verification code is 847291
```

## Migration Strategy

For existing users with emails already in Inbox:

1. **Don't auto-migrate** - leave existing emails where they are
2. **Apply triage to new emails only** - going forward
3. **Offer optional bulk triage** - user-initiated "Organize Inbox" action
4. **Learn from user corrections** - improve classification over time

## Provider Compatibility

| Provider | Folder Sync | Expected Behavior |
|----------|-------------|-------------------|
| Gmail | ✅ | Folders appear as labels |
| Proton (via Bridge) | ✅ | Works with Bridge running |
| Infomaniak | ✅ | Standard IMAP folders |
| iCloud | ✅ | Standard IMAP folders |
| Outlook/Hotmail | ✅ | Standard IMAP folders |
| Fastmail | ✅ | Supports nested folders |

## Success Criteria

1. **Inbox reduction:** 70%+ of emails auto-triaged out of Inbox
2. **Accuracy:** 85%+ user acceptance rate (no manual re-filing)
3. **Time saved:** <2 min daily to process remaining Inbox items
4. **Sync reliability:** Folders sync correctly to other clients (Apple Mail, etc.)

## Learning System

### Overview

The system improves over time through:
1. **Onboarding training** - User confirms/corrects 12 diverse emails
2. **Few-shot learning** - Past examples included in LLM prompt
3. **Sender rules** - Automatic rules from repeated corrections

### Onboarding Training Flow

```
Account connected & synced
      │
      ▼
Select 12 diverse emails (curated)
      │
      ▼
AI pre-classifies each
      │
      ▼
User confirms or corrects
      │
      ├─ [✓ Correct] → Store as confirmation
      │
      └─ [✗ Wrong...] → User picks folder → Store as correction
      │
      ▼
Training complete → Auto-classification enabled
```

### Curated Email Selection

Goal: Maximum diversity = maximum learning per email.

**Diversity buckets (fill one email per bucket):**

| Bucket | Pattern Signals |
|--------|-----------------|
| ecommerce | amazon, ebay, shop, order, shipped |
| social | linkedin, twitter, facebook, instagram |
| financial | bank, paypal, stripe, invoice, receipt |
| travel | airline, hotel, booking, flight, airbnb |
| newsletter | newsletter, digest, weekly, substack |
| dev | github, gitlab, jira, deploy, build |
| calendar | invite, meeting, calendar, event |
| marketing | sale, offer, discount, promo, unsubscribe |
| support | ticket, support, help, case |
| personal | gmail.com, outlook.com (no company domain) |
| security | verification, 2fa, security, sign-in |
| unknown | Senders not in contacts, unfamiliar domains |

**Selection algorithm:**

```typescript
const selectDiverseEmails = async (accountId: number): Promise<Email[]> => {
  const allEmails = await getRecentEmails(accountId, 500);
  const selected: Email[] = [];
  const usedDomains = new Set<string>();

  // Fill each bucket with ONE email
  for (const bucket of DIVERSITY_BUCKETS) {
    const match = allEmails.find(email => {
      const domain = extractDomain(email.from);
      if (usedDomains.has(domain)) return false;
      return matchesBucket(email, bucket);
    });

    if (match) {
      selected.push(match);
      usedDomains.add(extractDomain(match.from));
    }
  }

  // Fill remaining slots with most unique emails
  while (selected.length < 12) {
    const best = pickMostUnique(allEmails, selected, usedDomains);
    if (!best) break;
    selected.push(best);
    usedDomains.add(extractDomain(best.from));
  }

  return shuffle(selected);
};
```

**Uniqueness scoring:**
- Different TLD (+2)
- Company vs personal sender (+3)
- Has attachment when none selected do (+2)
- Different subject pattern (+2)
- Older than 7 days (+1)

### Training UI

```
┌─────────────────────────────────────────────────────────────┐
│  🎓 Train Pluribus                              Step 2/3   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📧 From: Amazon                                      │   │
│  │    Subject: Your order has shipped                   │   │
│  │    Preview: Track your package...                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  AI suggests: 📥 Inbox (shipping - snooze until delivery)  │
│                                                             │
│  ┌────────────────┐  ┌────────────────┐                    │
│  │  ✓ Correct     │  │  ✗ Wrong...   │                    │
│  └────────────────┘  └────────────────┘                    │
│                                                             │
│                              ━━━━━━━━━━░░░░░░░░ 4 of 12    │
└─────────────────────────────────────────────────────────────┘
```

### Training Data Schema

```sql
CREATE TABLE training_examples (
  id INTEGER PRIMARY KEY,
  account_id INTEGER,
  email_id INTEGER,
  from_address TEXT,
  from_domain TEXT,
  subject TEXT,
  ai_suggestion TEXT,         -- What AI suggested
  user_choice TEXT,           -- What user picked
  was_correction BOOLEAN,     -- true = user disagreed
  source TEXT,                -- 'onboarding', 'review_folder', 'manual_move'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sender-based learned rules (from repeated corrections)
CREATE TABLE sender_rules (
  id INTEGER PRIMARY KEY,
  account_id INTEGER,
  pattern TEXT NOT NULL,            -- 'amazon.com', '*@linkedin.com'
  pattern_type TEXT NOT NULL,       -- 'domain', 'email', 'subject_prefix'
  target_folder TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  correction_count INTEGER DEFAULT 1,
  auto_apply BOOLEAN DEFAULT false, -- Skip LLM if true
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Few-Shot Prompt Building

```typescript
const buildPromptWithLearning = async (email: Email, accountId: number) => {
  // Get training examples (onboarding + corrections)
  const examples = await db.query(`
    SELECT from_domain, subject, ai_suggestion, user_choice, was_correction
    FROM training_examples
    WHERE account_id = ?
    ORDER BY
      was_correction DESC,  -- Corrections first (more informative)
      created_at DESC       -- Recent first
    LIMIT 10
  `, accountId);

  return `${TRIAGE_PROMPT}

USER PREFERENCES (from training):
${examples.map(e =>
  e.was_correction
    ? `• ${e.from_domain}: AI suggested ${e.ai_suggestion}, user corrected to ${e.user_choice}`
    : `• ${e.from_domain}: ${e.user_choice} ✓`
).join('\n')}

EMAIL TO CLASSIFY:
From: ${email.from}
Subject: ${email.subject}
...`;
};
```

### Sender Rules (Auto-Generated)

After 3+ corrections for same sender → create rule:

```typescript
const learnFromCorrection = async (email: Email, toFolder: string) => {
  const domain = extractDomain(email.from);

  // Count corrections for this domain
  const count = await db.get(`
    SELECT COUNT(*) as n FROM training_examples
    WHERE from_domain = ? AND user_choice = ? AND was_correction = true
  `, [domain, toFolder]);

  if (count.n >= 3) {
    // Create or update sender rule
    await db.run(`
      INSERT INTO sender_rules (account_id, pattern, pattern_type, target_folder, correction_count)
      VALUES (?, ?, 'domain', ?, ?)
      ON CONFLICT(account_id, pattern) DO UPDATE SET
        correction_count = correction_count + 1,
        confidence = MIN(confidence + 0.05, 0.99),
        auto_apply = CASE WHEN correction_count >= 5 THEN true ELSE false END,
        updated_at = CURRENT_TIMESTAMP
    `, [email.accountId, domain, toFolder, count.n]);
  }
};
```

### Classification Flow with Learning

```
Email arrives
      │
      ▼
Check sender_rules (auto_apply = true)?
      │
      ├─ Yes → Apply rule directly (skip LLM)
      │        Log as source: 'sender_rule'
      │
      └─ No → Continue
              │
              ▼
         Pattern matching (hints)
              │
              ▼
         Build prompt with few-shot examples
              │
              ▼
         LLM classification
              │
              ▼
         Apply confidence threshold
              │
              ├─ High confidence → Move to folder
              │
              └─ Low confidence → Move to /Review
              │
              ▼
         User confirms/corrects
              │
              ▼
         Store as training example
              │
              ▼
         Update sender rules if threshold met
```

### Skip Training Option

```
┌─────────────────────────────────────────────────────────────┐
│  🎓 Train Pluribus                                          │
│                                                             │
│  Help us learn your preferences by reviewing 12 emails.     │
│  Takes about 2 minutes.                                     │
│                                                             │
│  [Start Training]                                           │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  Skip for now                                               │
│  (Uses default rules. Train later in Settings → Training)  │
└─────────────────────────────────────────────────────────────┘
```

## Error Handling & Edge Cases

### LLM Failure Fallback

```typescript
async classifyEmail(email) {
  const patternHint = matchPatterns(email);

  try {
    const llmResult = await deps.llm.classifyForTriage(email, patternHint);
    return applyConfidenceThreshold(llmResult);
  } catch (error) {
    // LLM failed - use pattern only, send to Review
    return {
      folder: 'Review',
      suggestedFolder: patternHint.folder,
      confidence: 0,
      reasoning: `LLM unavailable: ${error.message}`,
      source: 'pattern-fallback',
    };
  }
}
```

### Thread-Level Classification

- Classify based on **latest message** in thread
- Move **entire thread** to destination folder
- Consistent UX: thread stays together

### Conflict Resolution

| Scenario | Behavior |
|----------|----------|
| User manually moves email | Don't re-classify for 24h |
| Email in non-triage folder | Skip classification (user's custom folder) |
| Folder deleted in other client | Re-create on next sync, warn user |
| Classification disagrees with user history | Lower confidence, may go to Review |

### Multi-Account Support

- Each account has **separate folder structure**
- Folders created per-account on setup
- Settings can be account-specific or global

## Audit & Debugging

### Classification Log

```sql
CREATE TABLE classification_log (
  id INTEGER PRIMARY KEY,
  email_id INTEGER REFERENCES emails(id),
  account_id INTEGER,
  pattern_hint TEXT,
  llm_folder TEXT,
  llm_confidence REAL,
  pattern_agreed BOOLEAN,
  final_folder TEXT,           -- After confidence threshold
  source TEXT,                 -- 'llm', 'pattern-fallback', 'user-override'
  reasoning TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Track user corrections for learning
CREATE TABLE user_corrections (
  id INTEGER PRIMARY KEY,
  email_id INTEGER REFERENCES emails(id),
  from_folder TEXT,
  to_folder TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Debug View (Settings)

- Show recent classification decisions
- Filter by: folder, confidence, source
- Export log for troubleshooting

## Out of Scope (Future)

- Custom user-defined folders (v2)
- Rules engine for power users (v2)
- Shared/team folder taxonomies
- Cross-account unified triage
- Embedding-based similarity search (v2)
- Re-training on all past emails
