/**
 * Daily digest use cases.
 *
 * `findForgottenReplies` (P1) and `syncMailbox` are stubbed so these tests pin
 * down the digest orchestration only: credential gating, call order, email to
 * self, notification content and failure isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  Account,
  DigestSettings,
  DigestState,
  ForgottenReply,
  ForgottenRepliesResult,
} from '../domain';
import { DEFAULT_DIGEST_SETTINGS } from '../domain';

const m = vi.hoisted(() => ({
  find: vi.fn(),
  sync: vi.fn(),
  order: [] as string[],
}));

vi.mock('./reply-usecases', () => ({
  findForgottenReplies: () => m.find,
}));
vi.mock('./sync-usecases', () => ({
  syncMailbox: () => m.sync,
}));

import { runDailyDigest, sendPendingDigestEmails, renderDigestEmail } from './digest-usecases';

// ============================================
// Fixtures
// ============================================

const NOW = new Date('2026-03-10T08:00:00.000Z');

const mkAccount = (id: number, email: string, over: Partial<Account> = {}): Account => ({
  id,
  name: email,
  email,
  imapHost: 'imap.example.com',
  imapPort: 993,
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  username: email,
  isActive: true,
  lastSync: null,
  ...over,
});

const mkItem = (over: Partial<ForgottenReply> = {}): ForgottenReply => ({
  emailId: 1,
  accountId: 1,
  from: { address: 'alice@acme.test', name: 'Alice Martin' },
  subject: 'Contract renewal',
  date: new Date('2026-03-07T08:00:00.000Z'),
  ageHours: 72,
  folderPath: 'INBOX',
  needsReply: 0.9,
  importance: 3,
  score: 0.8,
  basis: 'signal',
  signalSource: 'system2',
  reason: 'Asks a direct question',
  ...over,
});

const mkResult = (
  account: Account,
  items: ForgottenReply[],
  sentHealth: 'ok' | 'no-sent-mail' = 'ok',
): ForgottenRepliesResult => ({
  accountId: account.id,
  accountEmail: account.email,
  items,
  sentHealth,
  generatedAt: NOW,
});

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(opts: {
  accounts?: Account[];
  settings?: Partial<DigestSettings>;
  unlocked?: string[];
  state?: Partial<DigestState>;
}) {
  const accounts = opts.accounts ?? [mkAccount(1, 'me@example.com')];
  const unlocked = new Set(opts.unlocked ?? []);
  // Conservative baseline: no Touch ID prompt and a count-only notification. Tests that rely on
  // the opposite say so explicitly; the product defaults have their own test ("product defaults").
  const settings: DigestSettings = {
    ...DEFAULT_DIGEST_SETTINGS,
    allowBiometricPrompt: false,
    showSubjects: false,
    ...opts.settings,
  };
  let state: DigestState = {
    lastRunDate: '2026-03-09',
    pendingEmailAccountIds: [],
    ...opts.state,
  };

  const notify = vi.fn();
  const send = vi.fn(async (_email: string, _smtp: unknown, _draft: unknown) => {
    m.order.push('send');
    return { messageId: '<id@x>', accepted: [], rejected: [] };
  });
  const appendToSent = vi.fn();
  const getPasswordIfUnlocked = vi.fn(async (email: string) =>
    unlocked.has(email) ? 'secret-pw' : null,
  );
  const getPassword = vi.fn(async () => {
    throw new Error('digest must never use the prompting getPassword');
  });

  const deps = {
    accounts: {
      findAll: async () => accounts,
      findById: async (id: number) => accounts.find((a) => a.id === id) ?? null,
    },
    digestConfig: {
      getSettings: () => settings,
      getState: () => state,
      setState: (s: DigestState) => {
        state = { ...s, pendingEmailAccountIds: [...s.pendingEmailAccountIds] };
      },
    },
    replyCandidates: {},
    notifier: { isSupported: () => true, notify },
    secrets: { getPasswordIfUnlocked, getPassword },
    sender: { send, testConnection: vi.fn() },
    sync: { appendToSent },
    emails: {},
    awaiting: {},
    llmGenerator: {},
    folders: {},
  };

  return {
    deps: deps as unknown as Parameters<typeof runDailyDigest>[0],
    accounts,
    notify,
    send,
    appendToSent,
    getPasswordIfUnlocked,
    getPassword,
    getState: () => state,
    setUnlocked: (email: string, on: boolean) =>
      on ? unlocked.add(email) : unlocked.delete(email),
  };
}

const notification = (h: Harness) => h.notify.mock.calls[0]?.[0] as { title: string; body: string };

const run = (h: Harness, trigger: 'scheduled' | 'manual' | 'test' = 'scheduled') =>
  runDailyDigest(h.deps)({ now: NOW, trigger });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  m.order.length = 0;
  m.find.mockReset();
  m.sync.mockReset();
  m.sync.mockImplementation(async () => {
    m.order.push('sync');
    return { newCount: 0, newEmailIds: [] };
  });
  m.find.mockImplementation(async (o: { accountId: number }) => {
    m.order.push('find');
    const acc = mkAccount(o.accountId, 'me@example.com');
    return mkResult(acc, [mkItem({ accountId: o.accountId })]);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================
// runDailyDigest
// ============================================

describe('product defaults', () => {
  it('asks for Touch ID at the scheduled run, shows senders and subjects, starts at login', () => {
    expect(DEFAULT_DIGEST_SETTINGS).toMatchObject({
      enabled: true,
      time: '09:00',
      graceHours: 96,
      minImportance: 2,
      emailToSelf: true,
      showSubjects: true,
      allowBiometricPrompt: true,
      launchAtLogin: true,
    });
  });
});

describe('runDailyDigest', () => {
  describe('locked credentials', () => {
    it('does not sync, still notifies from local data, defers the email and records it as pending', async () => {
      const h = makeHarness({});
      const res = await run(h);

      expect(m.sync).not.toHaveBeenCalled();
      expect(m.find).toHaveBeenCalledTimes(1);
      expect(h.send).not.toHaveBeenCalled();
      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.getState().pendingEmailAccountIds).toEqual([1]);
      expect(res.notified).toBe(true);
      expect(res.totalItems).toBe(1);
      expect(res.accounts).toEqual([
        { accountId: 1, itemCount: 1, synced: false, email: 'deferred', sentHealth: 'ok' },
      ]);
    });

    it('never calls the prompting getPassword', async () => {
      const h = makeHarness({ unlocked: ['me@example.com'] });
      await run(h);
      expect(h.getPassword).not.toHaveBeenCalled();
    });

    it('dedupes pending account ids and preserves lastRunDate', async () => {
      const h = makeHarness({ state: { lastRunDate: '2026-03-10', pendingEmailAccountIds: [1] } });
      await run(h);
      await run(h);
      expect(h.getState().pendingEmailAccountIds).toEqual([1]);
      expect(h.getState().lastRunDate).toBe('2026-03-10');
    });

    it('a failed prompted sync defers the email rather than prompting a second time', async () => {
      m.sync.mockRejectedValueOnce(new Error('Biometric authentication failed'));
      const h = makeHarness({ settings: { allowBiometricPrompt: true } });
      const res = await run(h, 'scheduled');

      expect(h.send).not.toHaveBeenCalled();
      expect(res.accounts[0]).toMatchObject({ synced: false, email: 'deferred' });
      expect(h.getState().pendingEmailAccountIds).toEqual([1]);
      expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it('prompting is only allowed for scheduled runs when allowBiometricPrompt is on', async () => {
      const scheduled = makeHarness({ settings: { allowBiometricPrompt: true } });
      const r1 = await run(scheduled, 'scheduled');
      expect(m.sync).toHaveBeenCalledTimes(1);
      expect(scheduled.send).toHaveBeenCalledTimes(1);
      expect(r1.accounts[0]).toMatchObject({ synced: true, email: 'sent' });

      m.sync.mockClear();
      const manual = makeHarness({ settings: { allowBiometricPrompt: true } });
      const r2 = await run(manual, 'manual');
      expect(m.sync).not.toHaveBeenCalled();
      expect(manual.send).not.toHaveBeenCalled();
      expect(r2.accounts[0]).toMatchObject({ synced: false, email: 'deferred' });
    });
  });

  describe('unlocked credentials', () => {
    it('syncs BEFORE computing forgotten replies, then emails the digest to the account address', async () => {
      const h = makeHarness({ unlocked: ['me@example.com'] });
      const res = await run(h);

      expect(m.order).toEqual(['sync', 'find', 'send']);
      expect(m.sync).toHaveBeenCalledWith(1);
      expect(m.find).toHaveBeenCalledWith({ accountId: 1, now: NOW });

      expect(h.send).toHaveBeenCalledTimes(1);
      const [email, smtp, draft] = h.send.mock.calls[0] as [string, any, any];
      expect(email).toBe('me@example.com');
      expect(smtp).toEqual({ host: 'smtp.example.com', port: 587, secure: false });
      expect(draft.to).toEqual(['me@example.com']);
      expect(draft.subject).toBe('[Pluribus] 1 email needs your reply');
      expect(draft.text).toContain('Contract renewal');
      expect(draft.html).toContain('Contract renewal');

      expect(res.accounts[0]).toEqual({
        accountId: 1,
        itemCount: 1,
        synced: true,
        email: 'sent',
        sentHealth: 'ok',
      });
    });

    it('uses implicit TLS for port 465 like the regular send path', async () => {
      const acc = mkAccount(1, 'me@example.com', { smtpPort: 465 });
      const h = makeHarness({ accounts: [acc], unlocked: ['me@example.com'] });
      await run(h);
      expect((h.send.mock.calls[0] as any[])[1]).toEqual({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
      });
    });

    it('sends via sender.send directly: nothing is appended to the Sent folder', async () => {
      const h = makeHarness({ unlocked: ['me@example.com'] });
      await run(h);
      expect(h.send).toHaveBeenCalledTimes(1);
      expect(h.appendToSent).not.toHaveBeenCalled();
    });

    it('a sent digest supersedes a deferred one for the same account', async () => {
      const h = makeHarness({
        unlocked: ['me@example.com'],
        state: { lastRunDate: '2026-03-10', pendingEmailAccountIds: [1, 7] },
      });
      await run(h);
      expect(h.getState().pendingEmailAccountIds).toEqual([7]);
      expect(h.getState().lastRunDate).toBe('2026-03-10');
    });

    it('carries on from local data when the sync fails', async () => {
      m.sync.mockRejectedValueOnce(new Error('network down'));
      const h = makeHarness({ unlocked: ['me@example.com'] });
      const res = await run(h);
      expect(m.find).toHaveBeenCalledTimes(1);
      expect(res.accounts[0]).toMatchObject({ synced: false, email: 'sent' });
      expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it("reports email 'failed' when sending throws and queues a retry for scheduled runs", async () => {
      const h = makeHarness({ unlocked: ['me@example.com'] });
      h.send.mockRejectedValueOnce(new Error('smtp down'));
      const res = await run(h, 'scheduled');
      expect(res.accounts[0]?.email).toBe('failed');
      expect(h.getState().pendingEmailAccountIds).toEqual([1]);
      expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it('a failed manual send is reported but not queued (the user is watching)', async () => {
      const h = makeHarness({ unlocked: ['me@example.com'] });
      h.send.mockRejectedValueOnce(new Error('smtp down'));
      const res = await run(h, 'manual');
      expect(res.accounts[0]?.email).toBe('failed');
      expect(h.getState().pendingEmailAccountIds).toEqual([]);
    });
  });

  describe('gating', () => {
    const noItems = () =>
      m.find.mockImplementation(async (o: { accountId: number }) =>
        mkResult(mkAccount(o.accountId, 'me@example.com'), []),
      );

    it('zero items on a scheduled run: no notification and no email', async () => {
      noItems();
      const h = makeHarness({ unlocked: ['me@example.com'] });
      const res = await run(h, 'scheduled');
      expect(h.notify).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
      expect(res.notified).toBe(false);
      expect(res.totalItems).toBe(0);
      expect(res.accounts[0]).toMatchObject({ itemCount: 0, email: 'skipped' });
    });

    it('zero items on a manual run: no notification and no email', async () => {
      noItems();
      const h = makeHarness({ unlocked: ['me@example.com'] });
      await run(h, 'manual');
      expect(h.notify).not.toHaveBeenCalled();
      expect(h.send).not.toHaveBeenCalled();
    });

    it("trigger 'test' notifies and emails even with zero items, marking the subject [test]", async () => {
      noItems();
      const h = makeHarness({ unlocked: ['me@example.com'] });
      const res = await run(h, 'test');
      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.send).toHaveBeenCalledTimes(1);
      const draft = (h.send.mock.calls[0] as any[])[2];
      expect(draft.subject.startsWith('[test] ')).toBe(true);
      expect(res.notified).toBe(true);
      expect(res.accounts[0]).toMatchObject({ itemCount: 0, email: 'sent' });
    });

    it('regular runs do not carry the [test] prefix', async () => {
      const h = makeHarness({ unlocked: ['me@example.com'] });
      await run(h, 'manual');
      expect((h.send.mock.calls[0] as any[])[2].subject.startsWith('[test]')).toBe(false);
    });

    it("sentHealth 'no-sent-mail' suppresses the email (and the notification: it has no items)", async () => {
      m.find.mockImplementation(async (o: { accountId: number }) =>
        mkResult(mkAccount(o.accountId, 'me@example.com'), [], 'no-sent-mail'),
      );
      const h = makeHarness({ unlocked: ['me@example.com'] });
      const res = await run(h, 'test');
      expect(h.send).not.toHaveBeenCalled();
      expect(res.accounts[0]).toMatchObject({ email: 'skipped', sentHealth: 'no-sent-mail' });
    });

    it('emailToSelf off: notifies but never emails or defers', async () => {
      const h = makeHarness({ unlocked: ['me@example.com'], settings: { emailToSelf: false } });
      const res = await run(h);
      expect(h.send).not.toHaveBeenCalled();
      expect(h.getState().pendingEmailAccountIds).toEqual([]);
      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(res.accounts[0]?.email).toBe('skipped');
    });

    it('does not notify when the platform has no notification support', async () => {
      const h = makeHarness({});
      (h.deps as any).notifier.isSupported = () => false;
      const res = await run(h);
      expect(h.notify).not.toHaveBeenCalled();
      expect(res.notified).toBe(false);
      expect(res.totalItems).toBe(1);
    });

    it('skips inactive accounts', async () => {
      const h = makeHarness({
        accounts: [
          mkAccount(1, 'a@example.com'),
          mkAccount(2, 'b@example.com', { isActive: false }),
        ],
      });
      const res = await run(h);
      expect(res.accounts.map((a) => a.accountId)).toEqual([1]);
    });
  });

  describe('failure isolation', () => {
    it("one account's failure does not stop the others", async () => {
      const a = mkAccount(1, 'a@example.com');
      const b = mkAccount(2, 'b@example.com');
      m.find.mockImplementation(async (o: { accountId: number }) => {
        if (o.accountId === 1) throw new Error('db locked');
        return mkResult(b, [mkItem({ accountId: 2 })]);
      });
      const h = makeHarness({ accounts: [a, b], unlocked: ['a@example.com', 'b@example.com'] });
      const res = await run(h);

      expect(res.accounts).toHaveLength(2);
      expect(res.accounts[0]).toMatchObject({ accountId: 1, itemCount: 0, email: 'failed' });
      expect(res.accounts[1]).toMatchObject({ accountId: 2, itemCount: 1, email: 'sent' });
      expect(res.totalItems).toBe(1);
      expect(res.notified).toBe(true);
      expect(h.send).toHaveBeenCalledTimes(1);
      expect((h.send.mock.calls[0] as any[])[0]).toBe('b@example.com');
    });

    it('a throwing notifier does not fail the run', async () => {
      const h = makeHarness({});
      h.notify.mockImplementation(() => {
        throw new Error('no dbus');
      });
      const res = await run(h);
      expect(res.notified).toBe(false);
      expect(res.totalItems).toBe(1);
    });
  });

  describe('notification content', () => {
    const items = [
      mkItem({
        emailId: 1,
        score: 0.5,
        from: { address: 'low@x.test', name: null },
        subject: 'Low one',
      }),
      mkItem({
        emailId: 2,
        score: 0.9,
        from: { address: 'top@x.test', name: 'Top Sender' },
        subject: 'Top one',
      }),
      mkItem({
        emailId: 3,
        score: 0.7,
        from: { address: 'mid@x.test', name: 'Mid Sender' },
        subject: 'Mid one',
      }),
      mkItem({
        emailId: 4,
        score: 0.1,
        from: { address: 'last@x.test', name: 'Last' },
        subject: 'Last one',
      }),
    ];

    it('is count-only when showSubjects is off (no senders, subjects or body text)', async () => {
      m.find.mockImplementation(async () => mkResult(mkAccount(1, 'me@example.com'), items));
      const h = makeHarness({});
      await run(h);
      expect(h.notify).toHaveBeenCalledWith({
        title: 'Needs your reply',
        body: '4 important emails are waiting for your reply',
      });
      const arg = JSON.stringify(h.notify.mock.calls[0]);
      expect(arg).not.toContain('Top one');
      expect(arg).not.toContain('Top Sender');
    });

    it('uses the singular for one email', async () => {
      const h = makeHarness({});
      await run(h);
      expect(notification(h).body).toBe('1 important email is waiting for your reply');
    });

    it('showSubjects lists at most 3 "Sender — Subject" lines, best first', async () => {
      m.find.mockImplementation(async () => mkResult(mkAccount(1, 'me@example.com'), items));
      const h = makeHarness({ settings: { showSubjects: true } });
      await run(h);
      const { title, body } = notification(h);
      expect(title).toBe('Needs your reply');
      expect(body.split('\n')).toEqual([
        'Top Sender — Top one',
        'Mid Sender — Mid one',
        'low@x.test — Low one',
      ]);
    });

    it('falls back to the count when showSubjects is on but a test run has no items', async () => {
      m.find.mockImplementation(async () => mkResult(mkAccount(1, 'me@example.com'), []));
      const h = makeHarness({ settings: { showSubjects: true } });
      await run(h, 'test');
      expect(notification(h).body).toBe('0 important emails are waiting for your reply');
    });

    it('aggregates the count across accounts', async () => {
      const a = mkAccount(1, 'a@example.com');
      const b = mkAccount(2, 'b@example.com');
      m.find.mockImplementation(async (o: { accountId: number }) =>
        mkResult(o.accountId === 1 ? a : b, [
          mkItem({ accountId: o.accountId }),
          mkItem({ accountId: o.accountId }),
        ]),
      );
      const h = makeHarness({ accounts: [a, b] });
      const res = await run(h);
      expect(res.totalItems).toBe(4);
      expect(notification(h).body).toBe('4 important emails are waiting for your reply');
      expect(h.notify).toHaveBeenCalledTimes(1);
    });

    it('flattens newlines in subjects so a notification cannot be spoofed with extra lines', async () => {
      m.find.mockImplementation(async () =>
        mkResult(mkAccount(1, 'me@example.com'), [mkItem({ subject: 'Hi\nFake line\r\nMore' })]),
      );
      const h = makeHarness({ settings: { showSubjects: true } });
      await run(h);
      expect(notification(h).body.split('\n')).toHaveLength(1);
    });
  });

  it('returns ranAt/trigger from the options', async () => {
    const h = makeHarness({});
    const res = await run(h, 'manual');
    expect(res.ranAt).toEqual(NOW);
    expect(res.trigger).toBe('manual');
  });
});

// ============================================
// sendPendingDigestEmails
// ============================================

describe('sendPendingDigestEmails', () => {
  const a = mkAccount(1, 'a@example.com');
  const b = mkAccount(2, 'b@example.com');

  beforeEach(() => {
    m.find.mockImplementation(async (o: { accountId: number }) => {
      const acc = o.accountId === 1 ? a : b;
      return mkResult(acc, [mkItem({ accountId: acc.id })]);
    });
  });

  it('sends for unlocked pending accounts, clears them and leaves locked ones', async () => {
    const h = makeHarness({
      accounts: [a, b],
      unlocked: ['a@example.com'],
      state: { lastRunDate: '2026-03-10', pendingEmailAccountIds: [1, 2] },
    });
    const sent = await sendPendingDigestEmails(h.deps)({ now: NOW });

    expect(sent).toBe(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect((h.send.mock.calls[0] as any[])[0]).toBe('a@example.com');
    expect((h.send.mock.calls[0] as any[])[2].to).toEqual(['a@example.com']);
    expect(h.getState().pendingEmailAccountIds).toEqual([2]);
    expect(h.getState().lastRunDate).toBe('2026-03-10');
    expect(h.getPassword).not.toHaveBeenCalled();
    // The data is recomputed at send time, never replayed from the deferral.
    expect(m.find).toHaveBeenCalledWith({ accountId: 1, now: NOW });
  });

  it('once the second account unlocks it is sent too', async () => {
    const h = makeHarness({
      accounts: [a, b],
      unlocked: ['a@example.com'],
      state: { pendingEmailAccountIds: [1, 2] },
    });
    await sendPendingDigestEmails(h.deps)({ now: NOW });
    h.setUnlocked('b@example.com', true);
    const sent = await sendPendingDigestEmails(h.deps)({ now: NOW });
    expect(sent).toBe(1);
    expect(h.getState().pendingEmailAccountIds).toEqual([]);
  });

  it('drops the pending marker without sending when there is nothing left to report', async () => {
    m.find.mockImplementation(async () => mkResult(a, [], 'ok'));
    const h = makeHarness({
      accounts: [a],
      unlocked: ['a@example.com'],
      state: { pendingEmailAccountIds: [1] },
    });
    const sent = await sendPendingDigestEmails(h.deps)();
    expect(sent).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.getState().pendingEmailAccountIds).toEqual([]);
  });

  it("drops the marker when sentHealth is 'no-sent-mail'", async () => {
    m.find.mockImplementation(async () => mkResult(a, [mkItem()], 'no-sent-mail'));
    const h = makeHarness({
      accounts: [a],
      unlocked: ['a@example.com'],
      state: { pendingEmailAccountIds: [1] },
    });
    expect(await sendPendingDigestEmails(h.deps)()).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.getState().pendingEmailAccountIds).toEqual([]);
  });

  it('does nothing (and reads no credentials) when nothing is pending', async () => {
    const h = makeHarness({ accounts: [a], unlocked: ['a@example.com'] });
    expect(await sendPendingDigestEmails(h.deps)()).toBe(0);
    expect(h.getPasswordIfUnlocked).not.toHaveBeenCalled();
    expect(m.find).not.toHaveBeenCalled();
  });

  it('drops pending markers for deleted accounts and when the digest email is turned off', async () => {
    const gone = makeHarness({
      accounts: [a],
      unlocked: ['a@example.com'],
      state: { pendingEmailAccountIds: [99] },
    });
    expect(await sendPendingDigestEmails(gone.deps)()).toBe(0);
    expect(gone.getState().pendingEmailAccountIds).toEqual([]);

    const off = makeHarness({
      accounts: [a],
      unlocked: ['a@example.com'],
      settings: { emailToSelf: false },
      state: { pendingEmailAccountIds: [1] },
    });
    expect(await sendPendingDigestEmails(off.deps)()).toBe(0);
    expect(off.send).not.toHaveBeenCalled();
    expect(off.getState().pendingEmailAccountIds).toEqual([]);
  });

  it('keeps the marker (and continues) when a send fails', async () => {
    const h = makeHarness({
      accounts: [a, b],
      unlocked: ['a@example.com', 'b@example.com'],
      state: { pendingEmailAccountIds: [1, 2] },
    });
    h.send.mockRejectedValueOnce(new Error('smtp down'));
    const sent = await sendPendingDigestEmails(h.deps)();
    expect(sent).toBe(1);
    expect(h.getState().pendingEmailAccountIds).toEqual([1]);
  });
});

// ============================================
// renderDigestEmail
// ============================================

describe('renderDigestEmail', () => {
  const account = mkAccount(1, 'me@example.com');

  it('uses the singular/plural subject', () => {
    const one = renderDigestEmail(mkResult(account, [mkItem()]), { now: NOW });
    expect(one.subject).toBe('[Pluribus] 1 email needs your reply');
    const two = renderDigestEmail(mkResult(account, [mkItem(), mkItem({ emailId: 2 })]), {
      now: NOW,
    });
    expect(two.subject).toBe('[Pluribus] 2 emails need your reply');
  });

  it('escapes HTML in subject, sender name, address, reason and account email', () => {
    const evil = '<script>alert(1)</script>';
    const html = renderDigestEmail(
      {
        ...mkResult(account, [
          mkItem({
            subject: `Hello ${evil}`,
            from: { address: `"><img src=x onerror=1>@evil.test`, name: evil },
            reason: `${evil} & "quoted" 'single'`,
          }),
        ]),
        accountEmail: `me+${evil}@example.com`,
      },
      { now: NOW },
    ).html;

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;quoted&quot;');
    expect(html).toContain('&#39;single&#39;');
  });

  it('keeps the plain-text part free of markup injection and control-line breaks', () => {
    const { text } = renderDigestEmail(
      mkResult(account, [mkItem({ subject: 'Line1\nInjected: header\r\nMore' })]),
      { now: NOW },
    );
    expect(text).not.toMatch(/\nInjected: header/);
    expect(text).toContain('Line1 Injected: header More');
  });

  it('contains sender, subject, age, importance label and reason for every item', () => {
    const r = renderDigestEmail(
      mkResult(account, [
        mkItem({ importance: 4, reason: 'Deadline mentioned', ageHours: 72 }),
        mkItem({
          emailId: 2,
          from: { address: 'bob@acme.test', name: null },
          subject: 'Quick question',
          date: new Date('2026-03-10T05:00:00.000Z'),
          ageHours: 3,
          importance: 2,
          reason: 'Direct question to you',
        }),
      ]),
      { now: NOW },
    );
    for (const part of [r.text, r.html]) {
      expect(part).toContain('Alice Martin');
      expect(part).toContain('alice@acme.test');
      expect(part).toContain('Contract renewal');
      expect(part).toContain('3 days ago');
      expect(part).toContain('Critical');
      expect(part).toContain('Deadline mentioned');
      expect(part).toContain('bob@acme.test');
      expect(part).toContain('Quick question');
      expect(part).toContain('3 hours ago');
      expect(part).toContain('Normal');
      expect(part).toContain('Direct question to you');
      expect(part).toContain(
        'Generated on your device by Pluribus. Turn off in Settings → Digest.',
      );
    }
  });

  it('never includes body text or snippets even if the data carries them', () => {
    const item = {
      ...mkItem(),
      snippet: 'SECRET-SNIPPET',
      body: 'SECRET-BODY',
      text: 'SECRET-TEXT',
    };
    const r = renderDigestEmail(mkResult(account, [item as ForgottenReply]), { now: NOW });
    for (const part of [r.subject, r.text, r.html]) {
      expect(part).not.toContain('SECRET');
    }
  });

  it('has no remote images, links, scripts or tracking pixels, and only inline styles', () => {
    const { html } = renderDigestEmail(mkResult(account, [mkItem()]), { now: NOW });
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/\bsrc=/i);
    expect(html).not.toMatch(/\bhref=/i);
    expect(html).toContain('style="');
  });

  it('renders a friendly message when there are no items (test digest)', () => {
    const r = renderDigestEmail(mkResult(account, []), { now: NOW });
    expect(r.subject).toBe('[Pluribus] 0 emails need your reply');
    expect(r.text).toContain('No important emails are waiting for your reply');
    expect(r.html).toContain('No important emails are waiting for your reply');
  });

  it('formats ages: hours, singular, days, and falls back to ageHours for an invalid date', () => {
    const at = (iso: string, over: Partial<ForgottenReply> = {}) =>
      renderDigestEmail(mkResult(account, [mkItem({ date: new Date(iso), ...over })]), { now: NOW })
        .text;
    expect(at('2026-03-10T07:30:00.000Z')).toContain('less than an hour ago');
    expect(at('2026-03-10T07:00:00.000Z')).toContain('1 hour ago');
    expect(at('2026-03-09T08:00:00.000Z')).toContain('1 day ago');
    expect(at('2026-03-01T08:00:00.000Z')).toContain('9 days ago');
    expect(at('not-a-date', { ageHours: 50 })).toContain('2 days ago');
  });
});
