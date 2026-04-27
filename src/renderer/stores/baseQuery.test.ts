import { describe, it, expect, vi } from 'vitest';
import { ipcBaseQuery } from './baseQuery';

const noopExtras = {
  signal: new AbortController().signal,
  abort: () => {},
  dispatch: vi.fn(),
  getState: () => ({}),
  extra: undefined,
  endpoint: 'test',
  type: 'query' as const,
  forced: false,
};

describe('ipcBaseQuery', () => {
  it('resolves with the IPC return value', async () => {
    const result = await ipcBaseQuery(
      () => Promise.resolve({ ok: true, count: 2 }),
      noopExtras,
      {},
    );
    expect(result).toEqual({ data: { ok: true, count: 2 } });
  });

  it('passes window.mailApi into the call', async () => {
    const spy = vi.fn().mockResolvedValue('done');
    await ipcBaseQuery(spy, noopExtras, {});
    expect(spy).toHaveBeenCalledWith(window.mailApi);
  });

  it('translates thrown Errors into RTK Query errors', async () => {
    const result = await ipcBaseQuery(
      () => Promise.reject(new Error('imap timeout')),
      noopExtras,
      {},
    );
    expect(result).toEqual({ error: { message: 'imap timeout' } });
  });

  it('stringifies non-Error rejection values', async () => {
    const result = await ipcBaseQuery(
      () =>
        new Promise((_resolve, reject) => {
          reject('boom');
        }),
      noopExtras,
      {},
    );
    expect(result).toEqual({ error: { message: 'boom' } });
  });
});
