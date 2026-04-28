import { describe, it, expect, vi } from 'vitest';
import {
  createFallbackClassifier,
  isRetryable,
  isFallbackable,
  type FallbackTransition,
} from './fallback';
import type { Email, EmailBody, Classification } from '../../core/domain';
import type { Classifier } from '../../core/ports';

const mkEmail = (id = 1): Email => ({
  id,
  messageId: `m${id}`,
  accountId: 1,
  folderId: 1,
  uid: id,
  subject: 's',
  from: { address: 's@x.com' },
  toAddresses: [],
  date: new Date(),
  snippet: 'snip',
  sizeBytes: 0,
  isRead: false,
  isStarred: false,
  hasAttachments: false,
  bodyFetched: false,
});

const okResult: Classification = {
  suggestedFolder: 'INBOX',
  confidence: 0.9,
  reasoning: 'ok',
  priority: 'normal',
};

function mkTier(label: string, impl: (email: Email, body?: EmailBody) => Promise<Classification>): {
  label: string;
  classifier: Classifier;
  spy: ReturnType<typeof vi.fn>;
} {
  const spy = vi.fn(impl);
  const classifier: Classifier = {
    classify: spy as any,
    getBudget: () => ({ used: 0, limit: 100, allowed: true }),
    getEmailBudget: () => ({ used: 0, limit: 100, allowed: true }),
  };
  return { label, classifier, spy };
}

const instantSleep = async () => {};

describe('isRetryable', () => {
  it('flags 429, 5xx, 529, and network errors as retryable', () => {
    expect(isRetryable(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('x'), { status: 500 }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('x'), { status: 503 }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('x'), { status: 529 }))).toBe(true);
    expect(isRetryable(new Error('fetch failed'))).toBe(true);
    expect(isRetryable(new Error('request timeout'))).toBe(true);
    expect(isRetryable(new Error('overloaded'))).toBe(true);
  });

  it('does not flag auth/400 errors', () => {
    expect(isRetryable(Object.assign(new Error('x'), { status: 401 }))).toBe(false);
    expect(isRetryable(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
    expect(isRetryable(new Error('boring programming error'))).toBe(false);
  });
});

describe('isFallbackable', () => {
  it('skips fallback for auth/bad-request/budget errors', () => {
    expect(isFallbackable(Object.assign(new Error('x'), { status: 401 }))).toBe(false);
    expect(isFallbackable(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
    expect(isFallbackable(new Error('Anthropic API key not set'))).toBe(false);
    expect(isFallbackable(new Error('Daily budget exceeded (100/100)'))).toBe(false);
  });

  it('allows fallback on transient failures', () => {
    expect(isFallbackable(Object.assign(new Error('overloaded'), { status: 529 }))).toBe(true);
    expect(isFallbackable(new Error('ECONNRESET'))).toBe(true);
  });
});

describe('createFallbackClassifier', () => {
  it('throws at construction if the tier list is empty', () => {
    expect(() => createFallbackClassifier([])).toThrow(/at least one tier/);
  });

  it('returns the primary tier result on the happy path', async () => {
    const primary = mkTier('primary', async () => okResult);
    const haiku = mkTier('haiku', async () => { throw new Error('should not reach'); });
    const cl = createFallbackClassifier([primary, haiku], { sleep: instantSleep });
    const result = await cl.classify(mkEmail());
    expect(result).toBe(okResult);
    expect(primary.spy).toHaveBeenCalledTimes(1);
    expect(haiku.spy).not.toHaveBeenCalled();
  });

  it('retries transient errors inside the same tier before falling back', async () => {
    let calls = 0;
    const primary = mkTier('primary', async () => {
      calls++;
      throw Object.assign(new Error('overloaded'), { status: 529 });
    });
    const haiku = mkTier('haiku', async () => okResult);
    const cl = createFallbackClassifier([primary, haiku], {
      sleep: instantSleep,
      maxRetriesPerTier: 2,
    });
    const result = await cl.classify(mkEmail());
    expect(result).toBe(okResult);
    // 3 total attempts on primary (1 original + 2 retries), then 1 on haiku
    expect(calls).toBe(3);
    expect(haiku.spy).toHaveBeenCalledTimes(1);
  });

  it('emits one transition per tier switch with the attempt count', async () => {
    const primary = mkTier('primary', async () => { throw new Error('fetch failed'); });
    const haiku = mkTier('haiku', async () => okResult);
    const transitions: FallbackTransition[] = [];
    const cl = createFallbackClassifier([primary, haiku], {
      sleep: instantSleep,
      maxRetriesPerTier: 1,
      onTransition: t => transitions.push(t),
    });
    await cl.classify(mkEmail(42));
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      emailId: 42,
      fromTier: 'primary',
      toTier: 'haiku',
      reason: 'error',
      attemptsInPreviousTier: 2, // original + 1 retry
    });
  });

  it('short-circuits on non-fallbackable errors (e.g. auth)', async () => {
    const authErr = Object.assign(new Error('invalid_api_key'), { status: 401 });
    const primary = mkTier('primary', async () => { throw authErr; });
    const haiku = mkTier('haiku', async () => okResult);
    const transitions: FallbackTransition[] = [];
    const cl = createFallbackClassifier([primary, haiku], {
      sleep: instantSleep,
      onTransition: t => transitions.push(t),
    });
    await expect(cl.classify(mkEmail())).rejects.toBe(authErr);
    expect(haiku.spy).not.toHaveBeenCalled();
    expect(transitions).toHaveLength(0);
  });

  it('short-circuits on daily-budget-exhausted so Haiku does not re-consume budget', async () => {
    const budgetErr = new Error('Daily budget exceeded (100/100)');
    const primary = mkTier('primary', async () => { throw budgetErr; });
    const haiku = mkTier('haiku', async () => okResult);
    const cl = createFallbackClassifier([primary, haiku], { sleep: instantSleep });
    await expect(cl.classify(mkEmail())).rejects.toBe(budgetErr);
    expect(haiku.spy).not.toHaveBeenCalled();
  });

  it('throws the last tier error when every tier fails', async () => {
    const err1 = new Error('t1 fetch failed');
    const err2 = new Error('t2 fetch failed');
    const t1 = mkTier('t1', async () => { throw err1; });
    const t2 = mkTier('t2', async () => { throw err2; });
    const cl = createFallbackClassifier([t1, t2], {
      sleep: instantSleep,
      maxRetriesPerTier: 0,
    });
    await expect(cl.classify(mkEmail())).rejects.toBe(err2);
  });

  it('waits the backoff between retries', async () => {
    const sleeps: number[] = [];
    const sleepSpy = async (ms: number) => { sleeps.push(ms); };
    let calls = 0;
    const primary = mkTier('primary', async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('overloaded'), { status: 529 });
      return okResult;
    });
    const cl = createFallbackClassifier([primary], {
      sleep: sleepSpy,
      maxRetriesPerTier: 2,
      baseBackoffMs: 100,
    });
    await cl.classify(mkEmail());
    expect(sleeps).toHaveLength(2);
    // First backoff ≈ 100 (±25%), second ≈ 200 (±25%).
    expect(sleeps[0]).toBeGreaterThanOrEqual(75);
    expect(sleeps[0]).toBeLessThanOrEqual(125);
    expect(sleeps[1]).toBeGreaterThanOrEqual(150);
    expect(sleeps[1]).toBeLessThanOrEqual(250);
  });

  it('delegates getBudget / getEmailBudget to the primary tier', async () => {
    const primary: FallbackTierUnderTest = mkTier('primary', async () => okResult);
    primary.classifier.getBudget = () => ({ used: 42, limit: 100, allowed: true });
    primary.classifier.getEmailBudget = () => ({ used: 7, limit: 50, allowed: true });
    const haiku = mkTier('haiku', async () => okResult);
    const cl = createFallbackClassifier([primary, haiku]);
    expect(cl.getBudget()).toEqual({ used: 42, limit: 100, allowed: true });
    expect(cl.getEmailBudget()).toEqual({ used: 7, limit: 50, allowed: true });
  });
});

type FallbackTierUnderTest = ReturnType<typeof mkTier>;
