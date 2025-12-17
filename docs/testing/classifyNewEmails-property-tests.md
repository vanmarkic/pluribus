# Property-Based Tests for classifyNewEmails (Refactor Validation)

## Overview

Comprehensive property-based regression tests for the `classifyNewEmails` function using fast-check.

## Refactor Context

**BEFORE** (Issue #55/#56):
- Called both `classifyAndApply()` AND `triageAndMoveEmail()` for each email
- Two separate LLM API calls per email
- Double the cost and time

**AFTER**:
- Only calls `triageAndMoveEmail()` 
- Syncs triage results to `classificationState` for ReviewQueue UI
- Single LLM call per email (50% cost reduction)

## Test Suite

Total: **10 property-based tests** with **4,000+ random test cases**

### 1. Budget Limits are Respected (1,100 runs)
- **Property**: `classified ≤ remainingBudget`
- **Property**: `classified + skipped = totalInput`
- **Property**: When budget exhausted, all emails skipped
- **Validates**: Budget enforcement prevents runaway API costs

### 2. Emails Sorted by Date - Most Recent First (500 runs)
- **Property**: Classification order = date descending
- **Property**: Most recent emails prioritized when budget limited
- **Validates**: Critical emails (recent) get classified first

### 3. Error Handling Continues on Failures (200 runs)
- **Property**: Individual email failures don't stop batch processing
- **Property**: Failed emails get 'error' status in classificationState
- **Property**: Successful emails still get proper state
- **Validates**: Resilience to LLM/IMAP transient errors

### 4. Classification State Properly Synced (1,000 runs)
- **Property**: Every processed email has state in classificationState
- **Property**: `suggestedFolder` matches triage result `folder`
- **Property**: `confidence` matches triage result `confidence`
- **Property**: `status` = 'classified' if confidence ≥ threshold, else 'pending_review'
- **Property**: `reasoning` preserved from triage
- **Property**: `classifiedAt` timestamp set
- **Property**: No errorMessage for successful classification
- **Validates**: ReviewQueue UI gets correct data

### 5. Same Input Produces Consistent Output Structure (1,000 runs)
- **Property**: Result has `{ classified, skipped, triaged }` structure
- **Property**: All counts are non-negative integers
- **Property**: `classified + skipped = total emails`
- **Property**: `triaged ≤ classified` (after refactor, should be equal)
- **Validates**: API contract stability

### 6. Empty Input Handling (200 runs)
- **Property**: Empty array → `{ classified: 0, skipped: 0, triaged: 0 }`
- **Property**: Non-existent email IDs filtered out gracefully
- **Validates**: Robustness to edge cases

### 7. Real-world Scenario: Partial Budget Exhaustion
- **Scenario**: 10 emails, budget remaining = 5
- **Validates**: Only 5 most recent classified, 5 skipped

## Test Execution

```bash
npm run test -- src/core/__tests__/classifyNewEmails.property.test.ts
```

**Performance**: ~3 seconds for 4,000+ test cases

## Key Invariants Verified

1. **Budget Safety**: `classifiedCount ≤ remainingBudget` (prevents cost overruns)
2. **Totals Match**: `classified + skipped = inputLength` (no emails lost)
3. **Date Priority**: Most recent emails classified first (user value)
4. **Error Resilience**: Continues on individual failures (batch robustness)
5. **State Sync**: Triage results → classificationState (UI correctness)
6. **Determinism**: Same input → same output structure (predictability)

## Coverage

- **Lines tested**: 875 (test file itself)
- **Random inputs generated**: 4,000+
- **Edge cases covered**: Empty input, null emails, budget=0, all errors, partial failures
- **Concurrency**: Not tested (single-threaded execution)

## Maintenance

When refactoring `classifyNewEmails`:
1. Run these tests first to establish baseline
2. Make changes
3. Re-run tests - they should still pass if behavior is preserved
4. If tests fail, either:
   - Fix the implementation (behavior changed unintentionally), OR
   - Update tests (intentional behavior change)

## Notes

- Tests use `fc.asyncProperty` for async code
- Mocks isolate classifyNewEmails from dependencies
- Tests focus on **observable behavior**, not implementation details
- Random test data ensures edge cases are discovered
