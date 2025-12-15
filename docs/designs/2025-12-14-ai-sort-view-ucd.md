# AI Sort View - User-Centered Design

## User Understanding

| Dimension | Definition |
|-----------|------------|
| **Who** | Technical user / Developer. Comfortable with config, values transparency over "magic". |
| **Goal** | Reduce time-to-important-email without losing control. Triage faster, not automate blindly. |
| **Motivation** | High email volume creates cognitive overhead. Distrusts black-box AI—needs to see *why*. |
| **Context** | Morning inbox review, async throughout day. Wants quick scans, dedicated triage time. |

## Jobs to Be Done

1. **Find important emails faster** — Surface high-priority items, reduce scanning time
2. **Auto-organize incoming mail** — Reduce manual tagging work, keep inbox structured
3. **Review AI suggestions in bulk** — Approve/reject AI tags before they're applied
4. **Train the AI over time** — Correct mistakes so AI learns preferences

## Approach Used

**C. Interaction Design** — Users known (technical), focus on task flows and information architecture.

**Key Design Principle:** Hide complexity. AI features live in dedicated "AI Sort" view, keeping regular Inbox clean and focused.

---

## Proposed Solution: Review Queue + Dashboard

### Architecture

```
SIDEBAR                      AI SORT VIEW (2 sub-views)
─────────                    ─────────────────────────────────────
📥 Inbox                     ┌─────────────────────────────────┐
📤 Sent                      │  [Dashboard]  [Review Queue(7)] │
📁 Tags                      └─────────────────────────────────┘
✨ AI Sort ──────→
⚙️ Settings
```

### Sub-View 1: Dashboard

**Purpose:** At-a-glance stats, budget tracking, training feedback.

**Elements:**
- **Stats cards:** Classified today, Pending review, Accuracy (30-day)
- **Budget bar:** Visual progress toward daily email limit
- **Recent activity:** Auto-tag summary, corrections made
- **Priority breakdown:** Distribution across High/Normal/Low
- **Actions:** "Classify Unprocessed" button, "Clear Pattern Cache"

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│    147      │  │     7       │  │    89%      │
│  Classified │  │   Pending   │  │  Accuracy   │
│   today     │  │   Review    │  │  (30 days)  │
└─────────────┘  └─────────────┘  └─────────────┘

Budget: ████████████░░░░ 147/200 emails today
```

### Sub-View 2: Review Queue

**Purpose:** Focused triage of low-confidence classifications.

**Two modes:**
1. **List view** — Batch operations, sortable by confidence/date/sender
2. **One-by-one** — Full email preview with AI reasoning panel

**List view elements:**
- Checkbox selection
- Email summary (sender, subject, confidence %, suggested tag)
- Sort controls
- Bulk actions: Accept Selected, Dismiss Selected, Tag As...

**One-by-one elements:**
- Navigation: Previous / "3 of 7" / Next
- Email preview (expandable to full view)
- AI Analysis panel: confidence bar, priority, suggested tags, reasoning
- Action buttons: Accept, Edit Tags, Skip, Dismiss
- Keyboard shortcuts: A/E/S/D/←→

```
┌─────────────────────────────────────────────────────────────┐
│  AI ANALYSIS                                                 │
│  ────────────                                                │
│  Confidence: ██████░░░░ 61%                                  │
│  Priority:   Normal                                          │
│  Suggested:  #support                                        │
│                                                              │
│  Reasoning:                                                  │
│  "Sender domain 'service.io' matches support pattern.        │
│   Subject contains 'ticket' keyword. Low confidence          │
│   because sender not in contacts."                           │
└─────────────────────────────────────────────────────────────┘
```

---

## User Journey

### Daily Workflow

1. **Morning:** Open app, sync runs with `autoClassify: true`
   - Badge appears on sidebar: "AI Sort (7)" = 7 pending

2. **Triage:** Click AI Sort → Dashboard
   - See stats: "147 classified, 89% accuracy"
   - Notice: "7 pending review"

3. **Review:** Click "Review Queue" tab
   - Sort by confidence (lowest first = most uncertain)
   - One-by-one mode for focused triage
   - Accept/Edit/Dismiss each suggestion

4. **Work:** Return to Inbox (clean, no AI noise)
   - Emails already tagged
   - Priority visible via tag colors

5. **Train:** Occasionally check accuracy metric
   - Corrections logged automatically
   - Pattern cache improves over time

### Edge Cases & Empty States

| State | Display | Action |
|-------|---------|--------|
| No API key | "Configure Anthropic API key in Settings" | Link to Settings |
| Budget exhausted | "Daily limit reached (200/200). Resets tomorrow." | Disable classify button |
| No unprocessed emails | "All caught up! No emails need classification." | Celebration state |
| All pending reviewed | "Review queue empty" | Switch to Dashboard |
| Classification error | "Failed to classify: [reason]" | Retry button |
| Low confidence | Yellow badge on row | Visual attention cue |

### State Machine

```
UNPROCESSED → CLASSIFYING → HIGH_CONF (auto-apply)
                         → PENDING (needs review)
                         → ERROR (retry/skip)

PENDING → USER_REVIEW → ACCEPT (apply tags)
                     → EDIT (modify tags)
                     → DISMISS (skip, no tags)
```

---

## Interaction Patterns

### Confidence as First-Class Data

- Visible in list as sortable column
- Detail view shows confidence bar + percentage
- Color coding: Green (>85%), Yellow (50-85%), Red (<50%)

### Bulk Operations

- Checkbox selection with Select All
- Actions appear when items selected
- Keyboard shortcuts for power users

### Progressive Disclosure

- List view: minimal info (sender, subject, confidence, tag)
- Hover: no additional detail (keeps list clean)
- One-by-one mode: full AI reasoning panel
- Click to open: complete email in EmailViewer

### Feedback Loop

- Every Accept/Edit/Dismiss logged
- Accuracy calculated from corrections
- Pattern cache invalidated on corrections

---

## Trade-offs Considered

### Why not Unified Smart Inbox (Approach A)?

- Technical users prefer separation of concerns
- AI noise in main inbox adds cognitive load during reading/writing
- Dedicated triage space allows deeper focus

### Why not Enhanced Inbox Overlay (Approach C)?

- Clutters main inbox with AI elements
- Technical users want AI as opt-in, not always-on
- Loses dedicated space for bulk review

### Why Review Queue + Dashboard (Approach B)?

- Clean separation: Inbox for reading, AI Sort for triage
- Dashboard provides training feedback (Job 4)
- One-by-one mode enables thoughtful review
- Stats satisfy technical user's desire for transparency

---

## Success Criteria

1. **Efficiency:** Time to process pending queue < 2 minutes for 10 emails
2. **Accuracy:** User accepts AI suggestion > 80% of time (no edits)
3. **Adoption:** User visits AI Sort view at least once per session
4. **Trust:** User enables `autoClassify` after 1 week of manual review
5. **Training:** Accuracy metric improves over 30-day period

---

## Implementation Components

### New Components Needed

| Component | Purpose |
|-----------|---------|
| `AISortView.tsx` | Container for Dashboard + Review Queue tabs |
| `AIDashboard.tsx` | Stats cards, budget bar, activity log |
| `ReviewQueue.tsx` | List view with bulk operations |
| `ReviewItem.tsx` | One-by-one triage interface |
| `AIAnalysisPanel.tsx` | Confidence bar + reasoning display |
| `AccuracyTracker.ts` | Adapter for logging corrections |

### Store Extensions

- `pendingReview: Email[]` — emails below confidence threshold
- `classificationStats: { today, accuracy, budget }` — dashboard data
- `reviewMode: 'list' | 'single'` — toggle state

### IPC Extensions

- `llm:getPendingReview` — fetch low-confidence emails
- `llm:getStats` — dashboard metrics
- `llm:logCorrection` — record user feedback

---

## Keyboard Shortcuts

| Key | Action (Review Queue) |
|-----|----------------------|
| `A` | Accept suggested tags |
| `E` | Edit tags (open picker) |
| `S` | Skip (next without action) |
| `D` | Dismiss (reject suggestion) |
| `←` | Previous email |
| `→` | Next email |
| `Space` | Toggle selection (list mode) |
| `Ctrl+A` | Select all (list mode) |

---

## Design Decisions

### 1. Dismissed emails are re-classifiable

Dismissed emails return to "unprocessed" state. User can re-trigger classification later (e.g., after AI learns from corrections). This supports iterative training—early dismissals may succeed after pattern cache improves.

**Implementation:** `DISMISSED` state stored with timestamp. "Classify Unprocessed" button includes dismissed emails older than 7 days, or user can manually re-classify.

### 2. Partial edits count as 98% accuracy

When user accepts suggestion but edits tags (adds/removes some), this counts as **98% accuracy** rather than 0% or 100%. Rationale: AI got close enough to be useful, minor corrections are expected.

**Accuracy formula:**
- Accept (no edit): 100%
- Accept + Edit: 98%
- Dismiss: 0%

**30-day accuracy** = weighted average of all classifications

### 3. Sidebar badge only shows when pending > 0

Badge appears as "AI Sort (7)" only when pending review count > 0. When queue is empty, sidebar shows clean "AI Sort" without badge. Reduces visual noise when everything is processed.

**Implementation:** Sidebar subscribes to `pendingReviewCount` from store, conditionally renders badge.

### 4. Dashboard shows top confused patterns

Dashboard includes a "Confused Patterns" section showing the top 5 sender/subject patterns where AI consistently gets low confidence or user dismisses. Helps technical user identify where to create manual rules or understand AI limitations.

**Display:**
```
CONFUSED PATTERNS (last 30 days)
────────────────────────────────
• *@newsletter.* — 12 dismissals, avg 52% confidence
• "RE: RE: RE:*" — 8 dismissals, avg 48% confidence
• unknown senders — 6 dismissals, avg 45% confidence
```

**Implementation:** Aggregate dismissed classifications by sender domain pattern and subject pattern. Surface top 5 by dismissal count.

### 5. Re-classify cooldown is user-configurable

Default: 7 days. Configurable in Settings under "Classification" section.

**Options:** 1 day, 3 days, 7 days (default), 14 days, Never (manual only)

**Implementation:** Add `reclassifyCooldownDays` to `LLMConfig` in `core/ports.ts`.

---

## All Design Decisions Summary

| # | Decision | Details |
|---|----------|---------|
| 1 | Dismissed emails re-classifiable | After cooldown period, returns to unprocessed |
| 2 | Partial edits = 98% accuracy | Accept+Edit counts as near-success |
| 3 | Badge only when pending > 0 | Clean sidebar when queue empty |
| 4 | Show confused patterns | Top 5 problem areas on Dashboard |
| 5 | Configurable cooldown | 1/3/7/14 days or manual-only |
