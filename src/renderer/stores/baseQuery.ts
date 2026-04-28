/**
 * Custom RTK Query base query that adapts the Electron IPC bridge
 * (`window.mailApi`) to RTK Query's request lifecycle.
 *
 * Each endpoint's `query` returns a function that receives the live mailApi
 * and returns a promise of its response. The base query awaits the promise
 * and translates rejections into RTK Query errors.
 */

import type { BaseQueryFn } from '@reduxjs/toolkit/query';

export type MailApi = typeof window.mailApi;

export type IpcCall<T> = (api: MailApi) => Promise<T>;

export type IpcError = { message: string };

export const ipcBaseQuery: BaseQueryFn<IpcCall<unknown>, unknown, IpcError> = async (
  call,
) => {
  try {
    const data = await call(window.mailApi);
    return { data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: { message } };
  }
};
