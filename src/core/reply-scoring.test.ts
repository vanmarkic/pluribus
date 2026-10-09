/**
 * Reply scoring: gating, heuristic fallback, ranking and reason text.
 * Pure functions - no deps, no I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  ageFactor,
  importanceWeight,
  looksPersonalSender,
  rankCandidates,
  scoreCandidate,
  GATE_MIN_IMPORTANCE,
  GATE_MIN_NEEDS_REPLY,
} from './reply-scoring';
import type { Email, EmailSignal, ImportanceLevel, ReplyCandidate, SignalSource } from './domain';

const NOW = new Date('2026-06-15T12:00:00.000Z');
const HOUR = 3_600_000;
const ctx = { now: NOW, graceHours: 24 };

function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * HOUR);
}

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 1,
    messageId: '<m1@x.com>',
    accountId: 1,
    folderId: 1,
    uid: 1,
    subject: 'Hello',
    from: { address: 'alice@example.com', name: 'Alice' },
    to: ['me@test.com'],
    date: hoursAgo(48),
    snippet: '',
    sizeBytes: 100,
    isRead: false,
    isStarred: false,
    hasAttachments: false,
    bodyFetched: false,
    inReplyTo: null,
    references: null,
    threadId: null,
    awaitingReply: false,
    awaitingReplySince: null,
    listUnsubscribe: null,
    listUnsubscribePost: null,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<EmailSignal> = {}): EmailSignal {
  return {
    emailId: 1,
    source: 'system2',
    needsReply: 1,
    importance: 3,
    folder: 'INBOX',
    confidence: 0.9,
    modelVersion: 'claude-haiku-4-5',
    updatedAt: NOW,
    ...overrides,
  };
}

function candidate(
  emailOverrides: Partial<Email> = {},
  signal: EmailSignal | null = makeSignal(),
  toIncludesMe = false,
): ReplyCandidate {
  return { email: makeEmail(emailOverrides), folderPath: 'INBOX', signal, toIncludesMe };
}

describe('importanceWeight', () => {
  it('increases monotonically with importance', () => {
    const levels: ImportanceLevel[] = [1, 2, 3, 4];
    const weights = levels.map(importanceWeight);
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeGreaterThan(weights[i - 1]!);
    }
  });

  it('weights an important email at 1.0', () => {
    expect(importanceWeight(3)).toBe(1);
  });
});

describe('ageFactor', () => {
  it('is 1.0 at the end of the grace period', () => {
    expect(ageFactor(24, 24)).toBe(1);
  });

  it('is 1.0 before grace ends (never below 1)', () => {
    expect(ageFactor(2, 24)).toBe(1);
    expect(ageFactor(-5, 24)).toBe(1);
  });

  it('grows linearly to 1.5 at 7 days, then stays flat', () => {
    expect(ageFactor(7 * 24, 24)).toBeCloseTo(1.5, 10);
    expect(ageFactor(14 * 24, 24)).toBeCloseTo(1.5, 10);
    expect(ageFactor(90 * 24, 24)).toBeCloseTo(1.5, 10);
    // halfway between 24h and 168h
    expect(ageFactor(96, 24)).toBeCloseTo(1.25, 10);
  });

  it('is monotonic non-decreasing', () => {
    let prev = 0;
    for (let h = 0; h <= 400; h += 7) {
      const f = ageFactor(h, 24);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('copes with a grace period longer than the ramp', () => {
    expect(ageFactor(400, 336)).toBe(1.5);
    expect(Number.isFinite(ageFactor(400, 336))).toBe(true);
  });

  it('defaults grace to 0', () => {
    expect(ageFactor(0)).toBe(1);
    expect(ageFactor(168)).toBeCloseTo(1.5, 10);
  });
});

describe('looksPersonalSender', () => {
  it.each(['alice@example.com', 'bob.smith@corp.io', 'info@small-shop.fr', 'jane+work@x.org'])(
    'treats %s as personal',
    (addr) => {
      expect(looksPersonalSender(addr)).toBe(true);
    },
  );

  it.each([
    'noreply@example.com',
    'no-reply@example.com',
    'no_reply@example.com',
    'NoReply@Example.com',
    'donotreply@example.com',
    'do-not-reply@example.com',
    'notifications@github.com',
    'notification@service.com',
    'notifications-noreply@github.com',
    'mailer-daemon@example.com',
    'MAILER-DAEMON@example.com',
    'postmaster@example.com',
    'bounces@mail.example.com',
    // French no-reply conventions (accent-insensitive)
    'ne-pas-repondre@example.fr',
    'nepasrepondre@example.fr',
    'ne_pas_repondre@example.fr',
    'ne.pas.repondre@example.fr',
    'Ne-Pas-Répondre@example.fr',
    'ne-pas-répondre@example.fr',
    'pas-de-reponse@example.fr',
    'pas-de-réponse@example.fr',
    'noreply-factures@example.fr',
  ])('treats %s as automated', (addr) => {
    expect(looksPersonalSender(addr)).toBe(false);
  });

  it('rejects addresses without a domain', () => {
    expect(looksPersonalSender('unknown')).toBe(false);
    expect(looksPersonalSender('')).toBe(false);
  });
});

describe('scoreCandidate - gating with a signal', () => {
  it('exposes the documented thresholds', () => {
    expect(GATE_MIN_IMPORTANCE).toBe(3);
    expect(GATE_MIN_NEEDS_REPLY).toBe(0.6);
  });

  it('accepts importance >= 3 and needsReply >= 0.6', () => {
    const item = scoreCandidate(candidate({}, makeSignal({ importance: 3, needsReply: 0.6 })), ctx);
    expect(item).not.toBeNull();
    expect(item).toMatchObject({
      emailId: 1,
      accountId: 1,
      basis: 'signal',
      signalSource: 'system2',
      importance: 3,
      needsReply: 0.6,
    });
  });

  it('rejects importance below 3', () => {
    expect(scoreCandidate(candidate({}, makeSignal({ importance: 2 })), ctx)).toBeNull();
    expect(scoreCandidate(candidate({}, makeSignal({ importance: 1 })), ctx)).toBeNull();
  });

  it('rejects needsReply below 0.6', () => {
    expect(scoreCandidate(candidate({}, makeSignal({ needsReply: 0.59 })), ctx)).toBeNull();
    expect(scoreCandidate(candidate({}, makeSignal({ needsReply: 0 })), ctx)).toBeNull();
  });

  it('does not fall back to the heuristic once a usable signal rejects the email', () => {
    const c = candidate(
      { subject: 'Can you send me the report?' },
      makeSignal({ needsReply: 0, importance: 1 }),
    );
    expect(scoreCandidate(c, ctx)).toBeNull();
  });

  it('accepts critical importance', () => {
    expect(scoreCandidate(candidate({}, makeSignal({ importance: 4 })), ctx)?.importance).toBe(4);
  });

  it('tolerates a user "done" signal with null importance (treated as important)', () => {
    const sig = makeSignal({ source: 'user', needsReply: 1, importance: null, confidence: 1 });
    const item = scoreCandidate(candidate({}, sig), ctx);
    expect(item).not.toBeNull();
    expect(item?.importance).toBe(3);
    expect(item?.signalSource).toBe('user');
  });

  it('treats a machine signal with null importance as normal (rejected)', () => {
    const sig = makeSignal({ source: 'system1', needsReply: 0.95, importance: null });
    expect(scoreCandidate(candidate({}, sig), ctx)).toBeNull();
  });

  it('falls back to the heuristic when the signal has no needsReply value', () => {
    const sig = makeSignal({ needsReply: null, importance: 4 });
    const withQuestion = candidate({ subject: 'Can you confirm the date?' }, sig);
    expect(scoreCandidate(withQuestion, ctx)?.basis).toBe('heuristic');
    const noQuestion = candidate({ subject: 'Thanks' }, sig);
    expect(scoreCandidate(noQuestion, ctx)).toBeNull();
  });

  it('computes ageHours from the email date', () => {
    const item = scoreCandidate(candidate({ date: hoursAgo(50) }), ctx);
    expect(item?.ageHours).toBeCloseTo(50, 6);
  });

  it('never reports a negative age', () => {
    const item = scoreCandidate(candidate({ date: new Date(NOW.getTime() + HOUR) }), ctx);
    expect(item?.ageHours).toBe(0);
  });

  it('copies the sender, subject, date and folder through', () => {
    const date = hoursAgo(30);
    const c = {
      ...candidate({ subject: 'Budget', date, from: { address: 'bob@x.com', name: null } }),
      folderPath: 'Planning',
    };
    expect(scoreCandidate(c, ctx)).toMatchObject({
      from: { address: 'bob@x.com', name: null },
      subject: 'Budget',
      date,
      folderPath: 'Planning',
    });
  });
});

describe('scoreCandidate - score', () => {
  it('is importanceWeight * needsReply * ageFactor', () => {
    const c = candidate({ date: hoursAgo(96) }, makeSignal({ importance: 4, needsReply: 0.8 }));
    const item = scoreCandidate(c, ctx);
    expect(item?.score).toBeCloseTo(importanceWeight(4) * 0.8 * ageFactor(96, 24), 10);
  });

  it('adds 10% when the user is a direct recipient', () => {
    const base = scoreCandidate(candidate({}, makeSignal(), false), ctx);
    const boosted = scoreCandidate(candidate({}, makeSignal(), true), ctx);
    expect(boosted!.score).toBeCloseTo(base!.score * 1.1, 10);
  });

  it('ranks older mail above newer mail otherwise equal', () => {
    const older = scoreCandidate(candidate({ date: hoursAgo(120) }), ctx)!;
    const newer = scoreCandidate(candidate({ date: hoursAgo(30) }), ctx)!;
    expect(older.score).toBeGreaterThan(newer.score);
  });
});

describe('scoreCandidate - heuristic (no signal)', () => {
  it('flags a personal question as importance 3, needsReply 0.6, basis heuristic', () => {
    const c = candidate({ subject: 'Are you free on Friday?' }, null);
    const item = scoreCandidate(c, ctx);
    expect(item).toMatchObject({
      basis: 'heuristic',
      signalSource: null,
      importance: 3,
      needsReply: 0.6,
    });
    expect(item!.score).toBeGreaterThan(0);
  });

  it('uses the snippet as well as the subject', () => {
    const c = candidate({ subject: 'Friday', snippet: 'Could you review the draft today?' }, null);
    expect(scoreCandidate(c, ctx)?.basis).toBe('heuristic');
  });

  it('rejects questions from automated senders', () => {
    const c = candidate(
      { subject: 'Is this you?', from: { address: 'no-reply@bank.com', name: null } },
      null,
    );
    expect(scoreCandidate(c, ctx)).toBeNull();
  });

  it('detects a French question without a question mark', () => {
    const c = candidate({ subject: 'Merci de me confirmer votre disponibilité' }, null);
    expect(scoreCandidate(c, ctx)).toMatchObject({ basis: 'heuristic', importance: 3 });
  });

  it('detects a French question with a question mark in the subject', () => {
    const c = candidate({ subject: "Pouvez-vous m'envoyer le devis avant vendredi ?" }, null);
    expect(scoreCandidate(c, ctx)?.basis).toBe('heuristic');
  });

  it('rejects French questions from French no-reply senders', () => {
    const c = candidate(
      {
        subject: 'Pouvez-vous confirmer votre adresse ?',
        from: { address: 'ne-pas-repondre@banque.fr', name: null },
      },
      null,
    );
    expect(scoreCandidate(c, ctx)).toBeNull();
  });

  it('rejects French informational mail', () => {
    const c = candidate({ subject: 'Juste pour info : réunion déplacée' }, null);
    expect(scoreCandidate(c, ctx)).toBeNull();
  });

  it('rejects mail that does not look like it expects an answer', () => {
    expect(scoreCandidate(candidate({ subject: 'FYI: new office hours' }, null), ctx)).toBeNull();
    expect(scoreCandidate(candidate({ subject: 'Thanks!' }, null), ctx)).toBeNull();
  });
});

describe('scoreCandidate - reason', () => {
  it('describes the heuristic case with the age', () => {
    const c = candidate({ subject: 'Are you free?', date: hoursAgo(72) }, null);
    expect(scoreCandidate(c, ctx)?.reason).toBe('Asked you a question 3 days ago');
  });

  it('says hours for young mail and "1 day ago" for singular', () => {
    const hours = scoreCandidate(candidate({ subject: 'Are you free?', date: hoursAgo(5) }, null), {
      now: NOW,
      graceHours: 1,
    });
    expect(hours?.reason).toBe('Asked you a question 5 hours ago');
    const day = scoreCandidate(
      candidate({ subject: 'Are you free?', date: hoursAgo(25) }, null),
      ctx,
    );
    expect(day?.reason).toBe('Asked you a question 1 day ago');
  });

  it('credits Claude for cloud system2 signals', () => {
    const sig = makeSignal({ source: 'system2', modelVersion: 'claude-haiku-4-5', importance: 3 });
    expect(scoreCandidate(candidate({}, sig), ctx)?.reason).toBe('Important · flagged by Claude');
  });

  it('credits the local model for non-Claude system2 signals', () => {
    const sig = makeSignal({ source: 'system2', modelVersion: 'mistral:7b', importance: 4 });
    expect(scoreCandidate(candidate({}, sig), ctx)?.reason).toBe(
      'Critical · flagged by local model',
    );
  });

  it('handles system2 signals without a model version', () => {
    const sig = makeSignal({ source: 'system2', modelVersion: null });
    expect(scoreCandidate(candidate({}, sig), ctx)?.reason).toBe('Important · flagged by AI');
  });

  it('credits the on-device model for system1 signals', () => {
    const sig = makeSignal({ source: 'system1', modelVersion: 'system1:folder@v3', importance: 3 });
    expect(scoreCandidate(candidate({}, sig), ctx)?.reason).toBe(
      'Marked important by the on-device model',
    );
  });

  it('credits the user for user signals', () => {
    const sig = makeSignal({ source: 'user', importance: 3, modelVersion: null });
    expect(scoreCandidate(candidate({}, sig), ctx)?.reason).toBe(
      'You marked this as needing a reply',
    );
  });

  it('never contains subject, snippet or body text', () => {
    const secret = 'Zebra-quartz-7731 confidential merger details';
    const sources: SignalSource[] = ['user', 'system2', 'system1'];
    const cases: ReplyCandidate[] = [
      candidate({ subject: `Can you ${secret}?`, snippet: secret }, null),
      ...sources.map((source) =>
        candidate({ subject: secret, snippet: secret }, makeSignal({ source })),
      ),
    ];
    for (const c of cases) {
      const item = scoreCandidate(c, ctx);
      expect(item).not.toBeNull();
      expect(item!.reason).not.toContain('Zebra');
      expect(item!.reason).not.toContain('merger');
      expect(item!.reason).not.toContain(c.email.from.address);
      expect(item!.reason.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('rankCandidates', () => {
  it('drops ungated mail and sorts the rest best-first', () => {
    const low = candidate({ id: 1 }, makeSignal({ emailId: 1, importance: 2 }));
    const mid = candidate({ id: 2, date: hoursAgo(30) }, makeSignal({ emailId: 2, importance: 3 }));
    const high = candidate(
      { id: 3, date: hoursAgo(30) },
      makeSignal({ emailId: 3, importance: 4, needsReply: 1 }),
    );
    const none = candidate({ id: 4, subject: 'ok thanks' }, null);

    const ranked = rankCandidates([low, mid, none, high], { ...ctx, maxItems: 10 });
    expect(ranked.map((r) => r.emailId)).toEqual([3, 2]);
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it('caps the list at maxItems', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      candidate({ id: i + 1, date: hoursAgo(30 + i) }, makeSignal({ emailId: i + 1 })),
    );
    expect(rankCandidates(many, { ...ctx, maxItems: 3 })).toHaveLength(3);
    expect(rankCandidates(many, { ...ctx, maxItems: 0 })).toHaveLength(0);
    expect(rankCandidates(many, { ...ctx, maxItems: 100 })).toHaveLength(8);
  });

  it('keeps the highest-scoring items when capping', () => {
    const items = [
      candidate({ id: 1, date: hoursAgo(30) }, makeSignal({ emailId: 1, importance: 3 })),
      candidate({ id: 2, date: hoursAgo(30) }, makeSignal({ emailId: 2, importance: 4 })),
      candidate({ id: 3, date: hoursAgo(200) }, makeSignal({ emailId: 3, importance: 3 })),
    ];
    const top = rankCandidates(items, { ...ctx, maxItems: 2 });
    expect(top.map((t) => t.emailId)).toEqual([2, 3]);
  });

  it('puts signal-based items before heuristic ones on equal score', () => {
    const heuristic = candidate({ id: 1, subject: 'Are you free?', date: hoursAgo(48) }, null);
    const signal = candidate(
      { id: 2, date: hoursAgo(48) },
      makeSignal({ emailId: 2, needsReply: 0.6, importance: 3 }),
    );
    const ranked = rankCandidates([heuristic, signal], { ...ctx, maxItems: 5 });
    expect(ranked[0]!.score).toBeCloseTo(ranked[1]!.score, 10);
    expect(ranked.map((r) => r.basis)).toEqual(['signal', 'heuristic']);
  });

  it('is deterministic for fully tied items (lower email id first)', () => {
    const a = candidate({ id: 5, date: hoursAgo(48) }, makeSignal({ emailId: 5 }));
    const b = candidate({ id: 4, date: hoursAgo(48) }, makeSignal({ emailId: 4 }));
    expect(rankCandidates([a, b], { ...ctx, maxItems: 5 }).map((r) => r.emailId)).toEqual([4, 5]);
  });

  it('does not mutate its input', () => {
    const input = [candidate({ id: 1 }), candidate({ id: 2 })];
    const copy = [...input];
    rankCandidates(input, { ...ctx, maxItems: 5 });
    expect(input).toEqual(copy);
  });
});
