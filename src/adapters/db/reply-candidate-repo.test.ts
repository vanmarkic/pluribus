/**
 * Reply Candidate Repository Tests
 *
 * "Important received emails I have not answered": SQL anti-join against the
 * user's own sent mail, reply reminders and the effective classifier signal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { createReplyCandidateRepo } from './reply-candidate-repo';
import { createSignalRepo } from './email-signals-repo';
import { createReplyReminderRepo } from './reply-reminders-repo';
import { getDb, initDb, closeDb } from './connection';
import { findForgottenReplies } from '../../core/usecases/reply-usecases';
import { DEFAULT_DIGEST_SETTINGS } from '../../core/domain';
import type { ReplyCandidateQuery } from '../../core/ports';
import type { Account, DigestSettings } from '../../core/domain';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const ME = 'me@test.com';
const NOW = new Date('2026-06-15T12:00:00.000Z');
const SINCE = new Date('2026-06-01T12:00:00.000Z'); // 14 days back
const UNTIL = new Date('2026-06-14T12:00:00.000Z'); // 24h grace

type NewEmail = {
  messageId: string;
  from?: string;
  to?: string[];
  date?: string;
  folderId?: number;
  accountId?: number;
  subject?: string;
  inReplyTo?: string | null;
  references?: string | null;
  threadId?: string | null;
  listUnsubscribe?: string | null;
};

let uid = 0;

/** Insert an email and return its id. Defaults: unanswered INBOX mail 2 days old from a stranger. */
function addEmail(e: NewEmail): number {
  uid += 1;
  const result = getDb()
    .prepare(
      `INSERT INTO emails (message_id, account_id, folder_id, uid, subject, from_address, from_name,
                           to_addresses, date, in_reply_to, "references", thread_id, list_unsubscribe)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.messageId,
      e.accountId ?? 1,
      e.folderId ?? 1,
      uid,
      e.subject ?? 'Hello',
      e.from ?? 'alice@example.com',
      JSON.stringify(e.to ?? [ME]),
      e.date ?? '2026-06-13T10:00:00.000Z',
      e.inReplyTo ?? null,
      e.references ?? null,
      e.threadId ?? null,
      e.listUnsubscribe ?? null,
    );
  return Number(result.lastInsertRowid);
}

function query(overrides: Partial<ReplyCandidateQuery> = {}): ReplyCandidateQuery {
  return {
    accountId: 1,
    myAddress: ME,
    since: SINCE,
    until: UNTIL,
    folders: ['INBOX', 'Planning', 'Review'],
    now: NOW,
    ...overrides,
  };
}

describe('replyCandidateRepo', () => {
  const repo = createReplyCandidateRepo(getDb);
  const signals = createSignalRepo(getDb);
  const reminders = createReplyReminderRepo(getDb);

  async function ids(overrides: Partial<ReplyCandidateQuery> = {}): Promise<number[]> {
    return (await repo.listUnanswered(query(overrides))).map((c) => c.email.id);
  }

  beforeEach(() => {
    uid = 0;
    initDb(':memory:', SCHEMA_PATH);
    const db = getDb();
    db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
             VALUES ('Test', '${ME}', 'imap.test.com', 'smtp.test.com', 'me'),
                    ('Other', 'other@test.com', 'imap.test.com', 'smtp.test.com', 'other')`);
    db.exec(`INSERT INTO folders (account_id, path, name) VALUES
             (1, 'INBOX', 'Inbox'), (1, 'Planning', 'Planning'), (1, 'Review', 'Review'),
             (1, 'Archive', 'Archive'), (1, 'Sent', 'Sent'), (2, 'INBOX', 'Inbox'), (2, 'Sent', 'Sent')`);
    // folder ids: 1 INBOX, 2 Planning, 3 Review, 4 Archive, 5 Sent (acct 1); 6 INBOX, 7 Sent (acct 2)
  });

  afterEach(() => {
    closeDb();
  });

  describe('basic listing', () => {
    it('lists unanswered received mail and maps the email, folder path and flags', async () => {
      const id = addEmail({ messageId: '<a@x>', subject: 'Question', to: [ME, 'bob@x.com'] });
      const [c] = await repo.listUnanswered(query());
      expect(c).toMatchObject({
        folderPath: 'INBOX',
        signal: null,
        toIncludesMe: true,
        email: { id, subject: 'Question', accountId: 1, messageId: '<a@x>' },
      });
      expect(c!.email.from.address).toBe('alice@example.com');
      expect(c!.email.date).toBeInstanceOf(Date);
    });

    it('returns newest first and honours limit', async () => {
      const a = addEmail({ messageId: '<a@x>', date: '2026-06-10T10:00:00.000Z' });
      const b = addEmail({ messageId: '<b@x>', date: '2026-06-12T10:00:00.000Z' });
      const c = addEmail({ messageId: '<c@x>', date: '2026-06-11T10:00:00.000Z' });
      expect(await ids()).toEqual([b, c, a]);
      expect(await ids({ limit: 2 })).toEqual([b, c]);
    });

    it('returns nothing for an empty folder list', async () => {
      addEmail({ messageId: '<a@x>' });
      expect(await ids({ folders: [] })).toEqual([]);
    });
  });

  describe('time window', () => {
    it('lists mail only once the grace period has elapsed', async () => {
      const old = addEmail({ messageId: '<old@x>', date: '2026-06-14T11:59:59.000Z' });
      addEmail({ messageId: '<fresh@x>', date: '2026-06-14T12:00:01.000Z' });
      addEmail({ messageId: '<today@x>', date: '2026-06-15T09:00:00.000Z' });
      expect(await ids()).toEqual([old]);
    });

    it('includes mail dated exactly at the window edges', async () => {
      const atSince = addEmail({ messageId: '<s@x>', date: SINCE.toISOString() });
      const atUntil = addEmail({ messageId: '<u@x>', date: UNTIL.toISOString() });
      expect((await ids()).sort()).toEqual([atSince, atUntil].sort());
    });

    it('excludes mail older than the lookback', async () => {
      addEmail({ messageId: '<ancient@x>', date: '2026-05-31T10:00:00.000Z' });
      expect(await ids()).toEqual([]);
    });

    it('moves with the window passed in', async () => {
      const id = addEmail({ messageId: '<a@x>', date: '2026-06-14T18:00:00.000Z' });
      expect(await ids()).toEqual([]);
      expect(await ids({ until: new Date('2026-06-15T00:00:00.000Z') })).toEqual([id]);
    });
  });

  describe('folders', () => {
    it('includes INBOX, Planning and Review, excludes everything else', async () => {
      const inbox = addEmail({ messageId: '<i@x>', folderId: 1 });
      const planning = addEmail({ messageId: '<p@x>', folderId: 2 });
      const review = addEmail({ messageId: '<r@x>', folderId: 3 });
      addEmail({ messageId: '<ar@x>', folderId: 4 });
      const found = await repo.listUnanswered(query());
      expect(found.map((c) => c.email.id).sort()).toEqual([inbox, planning, review].sort());
      expect(found.find((c) => c.email.id === planning)?.folderPath).toBe('Planning');
    });

    it('matches folder paths case-insensitively', async () => {
      const id = addEmail({ messageId: '<i@x>', folderId: 1 });
      expect(await ids({ folders: ['inbox'] })).toEqual([id]);
    });

    it('restricts to the requested folders', async () => {
      addEmail({ messageId: '<i@x>', folderId: 1 });
      const planning = addEmail({ messageId: '<p@x>', folderId: 2 });
      expect(await ids({ folders: ['Planning'] })).toEqual([planning]);
    });
  });

  describe('sender and headers', () => {
    it('excludes mail from me (any case)', async () => {
      addEmail({ messageId: '<m1@x>', from: 'Me@Test.COM' });
      addEmail({ messageId: '<m2@x>', from: ME });
      const other = addEmail({ messageId: '<o@x>' });
      expect(await ids()).toEqual([other]);
      expect(await ids({ myAddress: 'ME@TEST.COM' })).toEqual([other]);
    });

    it('excludes mail with a List-Unsubscribe header', async () => {
      addEmail({ messageId: '<n@x>', listUnsubscribe: '<mailto:unsub@news.com>' });
      const human = addEmail({ messageId: '<h@x>' });
      expect(await ids()).toEqual([human]);
    });

    it('does not treat an empty List-Unsubscribe as a newsletter', async () => {
      const id = addEmail({ messageId: '<e@x>', listUnsubscribe: '' });
      expect(await ids()).toEqual([id]);
    });

    it('reports whether the user is a direct recipient (case-insensitive, exact address)', async () => {
      const direct = addEmail({ messageId: '<d@x>', to: ['Me@TEST.com'] });
      const cc = addEmail({ messageId: '<c@x>', to: ['list@x.com'] });
      const lookalike = addEmail({ messageId: '<l@x>', to: ['notme@test.com', 'me@test.com.au'] });
      const found = await repo.listUnanswered(query());
      const byId = new Map(found.map((c) => [c.email.id, c.toIncludesMe]));
      expect(byId.get(direct)).toBe(true);
      expect(byId.get(cc)).toBe(false);
      expect(byId.get(lookalike)).toBe(false);
    });

    it('skips rows it cannot map (malformed to_addresses) instead of failing the list', async () => {
      const good = addEmail({ messageId: '<good@x>' });
      addEmail({ messageId: '<bad@x>' });
      getDb().prepare(`UPDATE emails SET to_addresses = '[' WHERE message_id = '<bad@x>'`).run();
      expect(await ids()).toEqual([good]);
    });
  });

  describe('answered detection', () => {
    function sentReply(e: NewEmail): number {
      return addEmail({ from: ME, folderId: 5, to: ['alice@example.com'], ...e });
    }

    it('excludes mail answered via In-Reply-To', async () => {
      addEmail({ messageId: '<q@x>' });
      sentReply({
        messageId: '<r@x>',
        inReplyTo: '<q@x>',
        date: '2026-06-13T12:00:00.000Z',
      });
      expect(await ids()).toEqual([]);
    });

    it('excludes mail answered via References', async () => {
      addEmail({ messageId: '<q@x>' });
      sentReply({
        messageId: '<r@x>',
        inReplyTo: '<other@x>',
        references: '<root@x> <q@x> <other@x>',
        date: '2026-06-13T12:00:00.000Z',
      });
      expect(await ids()).toEqual([]);
    });

    it('treats % and _ in Message-IDs literally when matching References', async () => {
      const weird = addEmail({ messageId: '<a_b%c@x>' });
      const lookalike = addEmail({ messageId: '<aXbYYc@x>' });
      sentReply({
        messageId: '<r@x>',
        references: '<aXbYYc@x>',
        date: '2026-06-13T12:00:00.000Z',
      });
      // Only the exact id is answered; '_' and '%' are not wildcards.
      expect(await ids()).toEqual([weird]);
      expect(await ids()).not.toContain(lookalike);
    });

    it('excludes mail answered by a later message from me in the same thread', async () => {
      addEmail({
        messageId: '<q@x>',
        threadId: '<root@x>',
        date: '2026-06-12T10:00:00.000Z',
      });
      sentReply({
        messageId: '<r@x>',
        threadId: '<root@x>',
        date: '2026-06-12T15:00:00.000Z',
      });
      expect(await ids()).toEqual([]);
    });

    it('does NOT count an earlier message from me in the thread as an answer', async () => {
      const q = addEmail({
        messageId: '<q@x>',
        threadId: '<root@x>',
        date: '2026-06-12T10:00:00.000Z',
      });
      sentReply({
        messageId: '<mine-first@x>',
        threadId: '<root@x>',
        date: '2026-06-11T09:00:00.000Z',
      });
      expect(await ids()).toEqual([q]);
    });

    it('does not match across different threads', async () => {
      const q = addEmail({ messageId: '<q@x>', threadId: '<t1@x>' });
      sentReply({
        messageId: '<r@x>',
        threadId: '<t2@x>',
        date: '2026-06-13T12:00:00.000Z',
      });
      expect(await ids()).toEqual([q]);
    });

    it('ignores threads when thread_id is null', async () => {
      const q = addEmail({ messageId: '<q@x>', threadId: null });
      sentReply({ messageId: '<r@x>', threadId: null, date: '2026-06-13T12:00:00.000Z' });
      expect(await ids()).toEqual([q]);
    });

    it('does not count a reply from someone else as an answer', async () => {
      const q = addEmail({ messageId: '<q@x>' });
      addEmail({
        messageId: '<r@x>',
        from: 'carol@example.com',
        inReplyTo: '<q@x>',
        date: '2026-06-13T12:00:00.000Z',
      });
      const found = await ids();
      expect(found).toContain(q);
    });

    it('recognises my reply regardless of the case of my address', async () => {
      addEmail({ messageId: '<q@x>' });
      sentReply({
        messageId: '<r@x>',
        from: 'ME@Test.com',
        inReplyTo: '<q@x>',
        date: '2026-06-13T12:00:00.000Z',
      });
      expect(await ids()).toEqual([]);
    });

    it("does not let another account's sent mail answer this account's mail", async () => {
      const q = addEmail({ messageId: '<q@x>', threadId: '<t@x>' });
      addEmail({
        messageId: '<r@x>',
        accountId: 2,
        folderId: 7,
        from: ME,
        inReplyTo: '<q@x>',
        threadId: '<t@x>',
        date: '2026-06-13T12:00:00.000Z',
      });
      expect(await ids()).toEqual([q]);
    });

    it("never returns another account's mail", async () => {
      addEmail({ messageId: '<other@x>', accountId: 2, folderId: 6 });
      const mine = addEmail({ messageId: '<mine@x>' });
      expect(await ids()).toEqual([mine]);
    });
  });

  describe('reply reminders', () => {
    it('excludes done and dismissed items', async () => {
      const done = addEmail({ messageId: '<d@x>' });
      const dismissed = addEmail({ messageId: '<x@x>' });
      const open = addEmail({ messageId: '<o@x>' });
      await reminders.set(done, 'done');
      await reminders.set(dismissed, 'dismissed');
      expect(await ids()).toEqual([open]);
    });

    it('hides snoozed items until the snooze expires', async () => {
      const id = addEmail({ messageId: '<s@x>' });
      await reminders.set(id, 'snoozed', new Date('2026-06-16T09:00:00.000Z'));
      expect(await ids()).toEqual([]);
      // Same query evaluated after the snooze ends
      expect(await ids({ now: new Date('2026-06-16T09:00:01.000Z') })).toEqual([id]);
    });

    it('brings a cleared reminder back', async () => {
      const id = addEmail({ messageId: '<s@x>' });
      await reminders.set(id, 'dismissed');
      expect(await ids()).toEqual([]);
      await reminders.clear(id);
      expect(await ids()).toEqual([id]);
    });
  });

  describe('effective signal', () => {
    it('attaches null when there is no signal', async () => {
      addEmail({ messageId: '<a@x>' });
      const [c] = await repo.listUnanswered(query());
      expect(c!.signal).toBeNull();
    });

    it('attaches the effective signal with precedence user > system2 > system1', async () => {
      const id = addEmail({ messageId: '<a@x>' });
      const base = {
        emailId: id,
        folder: null,
        confidence: 0.9,
        modelVersion: null,
      } as const;
      await signals.upsert({ ...base, source: 'system1', needsReply: 0.2, importance: 1 });
      expect((await repo.listUnanswered(query()))[0]!.signal).toMatchObject({
        source: 'system1',
        needsReply: 0.2,
      });

      await signals.upsert({ ...base, source: 'system2', needsReply: 1, importance: 3 });
      expect((await repo.listUnanswered(query()))[0]!.signal).toMatchObject({
        source: 'system2',
        needsReply: 1,
        importance: 3,
      });

      await signals.upsert({ ...base, source: 'user', needsReply: 0, importance: 1 });
      expect((await repo.listUnanswered(query()))[0]!.signal).toMatchObject({
        source: 'user',
        needsReply: 0,
        importance: 1,
      });
    });
  });

  describe('countSentByMe', () => {
    it('counts mail from me since the date (any case, this account only)', async () => {
      addEmail({ messageId: '<s1@x>', from: ME, folderId: 5, date: '2026-06-10T10:00:00.000Z' });
      addEmail({
        messageId: '<s2@x>',
        from: 'ME@test.com',
        folderId: 5,
        date: '2026-06-12T10:00:00.000Z',
      });
      addEmail({ messageId: '<s0@x>', from: ME, folderId: 5, date: '2026-05-01T10:00:00.000Z' });
      addEmail({ messageId: '<in@x>', date: '2026-06-12T10:00:00.000Z' });
      addEmail({
        messageId: '<s3@x>',
        from: ME,
        accountId: 2,
        folderId: 7,
        date: '2026-06-12T10:00:00.000Z',
      });
      expect(await repo.countSentByMe(1, ME, SINCE)).toBe(2);
      expect(await repo.countSentByMe(1, 'me@TEST.com', SINCE)).toBe(2);
      expect(await repo.countSentByMe(2, ME, SINCE)).toBe(1);
    });

    it('is zero when nothing was sent in the window', async () => {
      addEmail({ messageId: '<in@x>' });
      expect(await repo.countSentByMe(1, ME, SINCE)).toBe(0);
    });
  });
});

describe('findForgottenReplies on a real database', () => {
  const replyCandidates = createReplyCandidateRepo(getDb);
  const signals = createSignalRepo(getDb);
  const reminders = createReplyReminderRepo(getDb);

  const account: Account = {
    id: 1,
    name: 'Test',
    email: ME,
    imapHost: 'imap.test.com',
    imapPort: 993,
    smtpHost: 'smtp.test.com',
    smtpPort: 587,
    username: 'me',
    isActive: true,
    lastSync: null,
  };

  const settings: DigestSettings = { ...DEFAULT_DIGEST_SETTINGS };

  function run(overrides: Partial<DigestSettings> = {}) {
    return findForgottenReplies({
      replyCandidates,
      accounts: { findById: async () => account } as never,
      digestConfig: { getSettings: () => settings, getState: () => ({}) } as never,
    })({ accountId: 1, now: NOW, settings: overrides });
  }

  beforeEach(() => {
    uid = 0;
    initDb(':memory:', SCHEMA_PATH);
    const db = getDb();
    db.exec(`INSERT INTO accounts (name, email, imap_host, smtp_host, username)
             VALUES ('Test', '${ME}', 'imap.test.com', 'smtp.test.com', 'me')`);
    db.exec(`INSERT INTO folders (account_id, path, name) VALUES
             (1, 'INBOX', 'Inbox'), (1, 'Sent', 'Sent')`);
    // A sent mail inside the lookback so the digest is not suppressed.
    addEmail({
      messageId: '<sent@x>',
      from: ME,
      folderId: 2,
      date: '2026-06-10T10:00:00.000Z',
      to: ['someone@x.com'],
    });
  });

  afterEach(() => {
    closeDb();
  });

  it('lets a user signal override a system2 signal', async () => {
    const wanted = addEmail({ messageId: '<w@x>', subject: 'Contract' });
    const hidden = addEmail({ messageId: '<h@x>', subject: 'Offer' });
    const base = { folder: null, confidence: 0.9, modelVersion: 'claude-haiku-4-5' } as const;
    await signals.upsert({
      ...base,
      emailId: wanted,
      source: 'system2',
      needsReply: 1,
      importance: 3,
    });
    await signals.upsert({
      ...base,
      emailId: hidden,
      source: 'system2',
      needsReply: 1,
      importance: 4,
    });
    // The user says the second one is not important.
    await signals.upsert({
      ...base,
      emailId: hidden,
      source: 'user',
      needsReply: 0,
      importance: 1,
      modelVersion: null,
    });

    const result = await run();
    expect(result.sentHealth).toBe('ok');
    expect(result.items.map((i) => i.emailId)).toEqual([wanted]);
    expect(result.items[0]).toMatchObject({ basis: 'signal', signalSource: 'system2' });
  });

  it('applies the reminder state end to end', async () => {
    const a = addEmail({ messageId: '<a@x>' });
    const b = addEmail({ messageId: '<b@x>' });
    const base = { folder: null, confidence: 0.9, modelVersion: 'mistral:7b' } as const;
    for (const id of [a, b]) {
      await signals.upsert({
        ...base,
        emailId: id,
        source: 'system2',
        needsReply: 1,
        importance: 3,
      });
    }
    await reminders.set(a, 'snoozed', new Date('2026-06-20T00:00:00.000Z'));
    expect((await run()).items.map((i) => i.emailId)).toEqual([b]);
  });

  it('suppresses everything when no mail from me exists in the lookback', async () => {
    getDb().prepare(`DELETE FROM emails WHERE message_id = '<sent@x>'`).run();
    const id = addEmail({ messageId: '<a@x>' });
    await signals.upsert({
      emailId: id,
      source: 'system2',
      needsReply: 1,
      importance: 4,
      folder: null,
      confidence: 1,
      modelVersion: null,
    });
    const result = await run();
    expect(result.sentHealth).toBe('no-sent-mail');
    expect(result.items).toEqual([]);
  });
});
