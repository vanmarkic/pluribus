/**
 * Reply action use cases: done / snooze / not important.
 * Also checks that every new use case is registered in the factory.
 */

import { describe, it, expect, vi } from 'vitest';
import { markReplyDone, snoozeReply, dismissReply, listForgottenReplies } from './reply-usecases';
import { createUseCases } from './factory';
import type { Deps } from '../ports';
import { DEFAULT_DIGEST_SETTINGS } from '../domain';
import type { Account } from '../domain';

function makeDeps() {
  const replyReminders = {
    set: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    clear: vi.fn(async () => {}),
  };
  const signals = {
    upsert: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    getEffective: vi.fn(async () => null),
    listByEmail: vi.fn(async () => []),
    listBySource: vi.fn(async () => []),
  };
  return { replyReminders, signals };
}

describe('markReplyDone', () => {
  it('marks the reminder done and records a user needsReply=1 signal', async () => {
    const deps = makeDeps();
    await markReplyDone(deps)(7);

    expect(deps.replyReminders.set).toHaveBeenCalledWith(7, 'done');
    expect(deps.signals.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: 7, source: 'user', needsReply: 1 }),
    );
  });
});

describe('dismissReply', () => {
  it('dismisses the reminder and records a user "not important" signal', async () => {
    const deps = makeDeps();
    await dismissReply(deps)(9);

    expect(deps.replyReminders.set).toHaveBeenCalledWith(9, 'dismissed');
    expect(deps.signals.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: 9, source: 'user', needsReply: 0, importance: 1 }),
    );
  });
});

describe('snoozeReply', () => {
  it('snoozes until the given time without recording a signal', async () => {
    const deps = makeDeps();
    const until = new Date('2026-06-01T09:00:00.000Z');
    await snoozeReply(deps)(3, until);

    expect(deps.replyReminders.set).toHaveBeenCalledWith(3, 'snoozed', until);
    expect(deps.signals.upsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid date', async () => {
    const deps = makeDeps();
    await expect(snoozeReply(deps)(3, new Date('nope'))).rejects.toThrow(/snooze/i);
    expect(deps.replyReminders.set).not.toHaveBeenCalled();
  });
});

describe('listForgottenReplies', () => {
  const account = (id: number, isActive: boolean): Account => ({
    id,
    name: `Account ${id}`,
    email: `me${id}@test.com`,
    imapHost: 'imap.test.com',
    imapPort: 993,
    smtpHost: 'smtp.test.com',
    smtpPort: 587,
    username: `me${id}`,
    isActive,
    lastSync: null,
  });

  it('returns one empty, healthy result per active account', async () => {
    const accounts = [account(1, true), account(2, false), account(3, true)];
    const deps = {
      accounts: {
        findAll: async () => accounts,
        findById: async (id: number) => accounts.find((a) => a.id === id) ?? null,
      },
      replyCandidates: { listUnanswered: async () => [], countSentByMe: async () => 1 },
      digestConfig: { getSettings: () => DEFAULT_DIGEST_SETTINGS },
    } as unknown as Pick<Deps, 'accounts' | 'replyCandidates' | 'digestConfig'>;

    const now = new Date('2026-06-01T09:00:00.000Z');
    const results = await listForgottenReplies(deps)({ now });

    expect(results.map((r) => r.accountId)).toEqual([1, 3]);
    expect(results[0]).toEqual({
      accountId: 1,
      accountEmail: 'me1@test.com',
      items: [],
      sentHealth: 'ok',
      generatedAt: now,
    });
  });
});

describe('createUseCases registration', () => {
  it('registers every reply digest and System 1 use case as a function', () => {
    const useCases = createUseCases({} as Deps);
    for (const name of [
      'findForgottenReplies',
      'listForgottenReplies',
      'markReplyDone',
      'snoozeReply',
      'dismissReply',
      'backfillReplySignals',
      'runDailyDigest',
      'sendPendingDigestEmails',
      'getSystem1Status',
      'trainSystem1',
      'recordSystem1Audit',
    ] as const) {
      expect(typeof useCases[name]).toBe('function');
    }
  });
});
