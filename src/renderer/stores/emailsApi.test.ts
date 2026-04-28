import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { Email } from '../../core/domain';
import { emailsApi, type ListEmailsArg } from './emailsApi';

const buildEmail = (id: number, overrides: Partial<Email> = {}): Email => ({
  id,
  accountId: 1,
  folderId: 1,
  uid: id,
  messageId: `msg-${id}`,
  subject: `Subject ${id}`,
  from: { address: `s${id}@x.test`, name: null },
  to: [`r${id}@x.test`],
  date: new Date('2026-01-01T00:00:00Z'),
  snippet: '',
  sizeBytes: 0,
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
});

const makeStore = () =>
  configureStore({
    reducer: { [emailsApi.reducerPath]: emailsApi.reducer },
    middleware: (getDefault) => getDefault().concat(emailsApi.middleware),
  });

const listArg: ListEmailsArg = { accountId: 1, folderPath: 'INBOX' };

describe('emailsApi optimistic updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flips isStarred immediately and keeps it on success', async () => {
    const store = makeStore();
    const seed = [buildEmail(1, { isStarred: false }), buildEmail(2)];
    (window.mailApi.emails.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(seed);
    (window.mailApi.emails.star as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await store.dispatch(emailsApi.endpoints.listEmails.initiate(listArg));

    const promise = store.dispatch(
      emailsApi.endpoints.setStarred.initiate({ id: 1, isStarred: true, listArg }),
    );

    // Mid-flight: cache already reflects the change.
    const midFlight = emailsApi.endpoints.listEmails.select(listArg)(store.getState()).data;
    expect(midFlight?.find((e) => e.id === 1)?.isStarred).toBe(true);

    await promise;

    const afterSuccess = emailsApi.endpoints.listEmails.select(listArg)(store.getState()).data;
    expect(afterSuccess?.find((e) => e.id === 1)?.isStarred).toBe(true);
    expect(window.mailApi.emails.star).toHaveBeenCalledWith(1, true);
  });

  it('rolls back the optimistic change when the IPC call rejects', async () => {
    const store = makeStore();
    const seed = [buildEmail(7, { isStarred: false })];
    (window.mailApi.emails.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(seed);
    (window.mailApi.emails.star as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('imap denied'),
    );

    await store.dispatch(emailsApi.endpoints.listEmails.initiate(listArg));

    await store.dispatch(
      emailsApi.endpoints.setStarred.initiate({ id: 7, isStarred: true, listArg }),
    );

    const finalState = emailsApi.endpoints.listEmails.select(listArg)(store.getState()).data;
    expect(finalState?.find((e) => e.id === 7)?.isStarred).toBe(false);
  });

  it('removes archived email from list immediately', async () => {
    const store = makeStore();
    const seed = [buildEmail(1), buildEmail(2), buildEmail(3)];
    (window.mailApi.emails.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce(seed);
    (window.mailApi.emails.archive as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await store.dispatch(emailsApi.endpoints.listEmails.initiate(listArg));

    const promise = store.dispatch(
      emailsApi.endpoints.archiveEmail.initiate({ id: 2, listArg }),
    );

    const midFlight = emailsApi.endpoints.listEmails.select(listArg)(store.getState()).data;
    expect(midFlight?.map((e) => e.id)).toEqual([1, 3]);

    await promise;

    expect(window.mailApi.emails.archive).toHaveBeenCalledWith(2);
  });
});
