import { describe, it, expect, vi } from 'vitest';
import { countPlaintextBodies, migrateEmailBodiesToEncrypted } from './body-migration-usecases';
import type { BodyMigrationRepo } from '../ports';

function mkRepo(
  plaintextRows: Array<{ emailId: number; bodyText: string | null; bodyHtml: string | null }>,
  countSummary = { total: 0, plaintext: 0, encrypted: 0 },
): BodyMigrationRepo {
  return {
    countByStatus: vi.fn(async () => ({
      ...countSummary,
      total: countSummary.total || (countSummary.plaintext + countSummary.encrypted),
    })),
    listPlaintextRows: vi.fn(async () => plaintextRows),
  };
}

describe('countPlaintextBodies', () => {
  it('delegates to the port', async () => {
    const bodyMigration = mkRepo([], { total: 5, plaintext: 2, encrypted: 3 });
    const result = await countPlaintextBodies({ bodyMigration } as any)();
    expect(result).toEqual({ total: 5, plaintext: 2, encrypted: 3 });
    expect(bodyMigration.countByStatus).toHaveBeenCalled();
  });
});

describe('migrateEmailBodiesToEncrypted', () => {
  it('queues every plaintext row for re-save', async () => {
    const rows = [
      { emailId: 2, bodyText: 'plain', bodyHtml: 'plain' },
      { emailId: 4, bodyText: 'v1:ok', bodyHtml: 'plain mixed' },
    ];
    const bodyMigration = mkRepo(rows);
    const saveBody = vi.fn(async () => {});
    const start = vi.fn((_id, _total, fn) => { void fn(() => {}); });
    const deps = {
      bodyMigration,
      emails: { saveBody } as any,
      backgroundTasks: { start } as any,
    };

    const result = await migrateEmailBodiesToEncrypted(deps as any)();
    expect(result.total).toBe(2);
    expect(start).toHaveBeenCalledWith(result.taskId, 2, expect.any(Function));
    await new Promise(r => setTimeout(r, 0));
    const migratedIds = saveBody.mock.calls.map(c => c[0]);
    expect(migratedIds).toEqual([2, 4]);
  });

  it('continues past single-row failures', async () => {
    const bodyMigration = mkRepo([
      { emailId: 1, bodyText: 'plain a', bodyHtml: 'plain' },
      { emailId: 2, bodyText: 'plain b', bodyHtml: 'plain' },
      { emailId: 3, bodyText: 'plain c', bodyHtml: 'plain' },
    ]);
    const saveBody = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const start = vi.fn((_id, _total, fn) => { void fn(() => {}); });
    await migrateEmailBodiesToEncrypted({
      bodyMigration,
      emails: { saveBody } as any,
      backgroundTasks: { start } as any,
    } as any)();
    await new Promise(r => setTimeout(r, 0));
    expect(saveBody).toHaveBeenCalledTimes(3);
  });

  it('reports total=0 when everything is already encrypted (idempotent re-runs)', async () => {
    const bodyMigration = mkRepo([]);
    const saveBody = vi.fn();
    const start = vi.fn((_id, _total, fn) => { void fn(() => {}); });
    const result = await migrateEmailBodiesToEncrypted({
      bodyMigration,
      emails: { saveBody } as any,
      backgroundTasks: { start } as any,
    } as any)();
    expect(result.total).toBe(0);
    expect(saveBody).not.toHaveBeenCalled();
  });
});
