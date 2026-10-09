/**
 * Reply Reminders Repository
 *
 * Tracks what the user did with a "needs your reply" item: marked it done,
 * dismissed it as not important, or snoozed it until a later time.
 * One row per email; setting a new state replaces the previous one.
 */

import Database from 'better-sqlite3';
import type { ReplyReminderRepo } from '../../core/ports';
import type { ReplyReminder, ReplyReminderState } from '../../core/domain';

function parseTimestamp(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}

function mapReminder(row: any): ReplyReminder {
  return {
    emailId: row.email_id,
    state: row.state as ReplyReminderState,
    snoozedUntil: row.snoozed_until ? parseTimestamp(row.snoozed_until) : null,
    updatedAt: parseTimestamp(row.updated_at),
  };
}

export function createReplyReminderRepo(getDb: () => Database.Database): ReplyReminderRepo {
  return {
    async set(emailId, state, snoozedUntil) {
      if (state === 'snoozed' && !snoozedUntil) {
        throw new Error('snoozedUntil is required when state is "snoozed"');
      }
      // Only snoozed reminders carry a wake-up time.
      const until = state === 'snoozed' && snoozedUntil ? snoozedUntil.toISOString() : null;
      getDb()
        .prepare(
          `
        INSERT INTO reply_reminders (email_id, state, snoozed_until, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(email_id) DO UPDATE SET
          state = excluded.state,
          snoozed_until = excluded.snoozed_until,
          updated_at = excluded.updated_at
      `,
        )
        .run(emailId, state, until, new Date().toISOString());
    },

    async get(emailId) {
      const row = getDb().prepare('SELECT * FROM reply_reminders WHERE email_id = ?').get(emailId);
      return row ? mapReminder(row) : null;
    },

    async clear(emailId) {
      getDb().prepare('DELETE FROM reply_reminders WHERE email_id = ?').run(emailId);
    },
  };
}
