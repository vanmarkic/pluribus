import { describe, it, expect } from 'vitest';
import { mapEmail } from './mappers';

describe('mapEmail', () => {
  const baseRow = {
    id: 1,
    message_id: 'msg-1',
    account_id: 1,
    folder_id: 1,
    uid: 100,
    subject: 'Test',
    from_address: 'sender@test.com',
    from_name: 'Sender',
    to_addresses: '[]',
    date: '2025-01-01T00:00:00Z',
    snippet: 'Hello',
    size_bytes: 1000,
    is_read: 0,
    is_starred: 0,
    has_attachments: 0,
    body_fetched: 0,
  };

  it('maps threading fields', () => {
    const row = {
      ...baseRow,
      in_reply_to: '<parent@test.com>',
      references: '<root@test.com> <parent@test.com>',
      thread_id: '<root@test.com>',
    };

    const email = mapEmail(row);

    expect(email.inReplyTo).toBe('<parent@test.com>');
    expect(email.references).toBe('<root@test.com> <parent@test.com>');
    expect(email.threadId).toBe('<root@test.com>');
  });

  it('maps awaiting reply fields', () => {
    const row = {
      ...baseRow,
      awaiting_reply: 1,
      awaiting_reply_since: '2025-01-01T00:00:00Z',
    };

    const email = mapEmail(row);

    expect(email.awaitingReply).toBe(true);
    expect(email.awaitingReplySince).toEqual(new Date('2025-01-01T00:00:00Z'));
  });

  it('maps unsubscribe fields', () => {
    const row = {
      ...baseRow,
      list_unsubscribe: '<mailto:unsub@test.com>, <https://test.com/unsub>',
      list_unsubscribe_post: 'List-Unsubscribe=One-Click',
    };

    const email = mapEmail(row);

    expect(email.listUnsubscribe).toBe('<mailto:unsub@test.com>, <https://test.com/unsub>');
    expect(email.listUnsubscribePost).toBe('List-Unsubscribe=One-Click');
  });

  it('handles null values for new fields', () => {
    const email = mapEmail(baseRow);

    expect(email.inReplyTo).toBeNull();
    expect(email.references).toBeNull();
    expect(email.threadId).toBeNull();
    expect(email.awaitingReply).toBe(false);
    expect(email.awaitingReplySince).toBeNull();
    expect(email.listUnsubscribe).toBeNull();
    expect(email.listUnsubscribePost).toBeNull();
  });
});
