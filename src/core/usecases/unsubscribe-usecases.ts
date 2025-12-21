// src/core/usecases/unsubscribe-usecases.ts
import type { UnsubscribeInfo } from '../domain';

export function parseUnsubscribe(
  listUnsubscribe: string | null,
  listUnsubscribePost?: string | null
): UnsubscribeInfo {
  if (!listUnsubscribe) {
    return { mailto: null, https: null, oneClick: false };
  }

  const mailtoMatch = listUnsubscribe.match(/<mailto:([^>]+)>/);
  const httpsMatch = listUnsubscribe.match(/<(https:[^>]+)>/);

  return {
    mailto: mailtoMatch?.[1] ?? null,
    https: httpsMatch?.[1] ?? null,
    oneClick: listUnsubscribePost?.toLowerCase().includes('one-click') ?? false,
  };
}

export type UnsubscribePort = {
  sendUnsubscribeEmail(to: string): Promise<void>;
  postOneClick(url: string): Promise<void>;
  openExternal(url: string): Promise<void>;
};

export const executeUnsubscribe = (deps: { unsubscribe: UnsubscribePort }) =>
  async (info: UnsubscribeInfo): Promise<'email' | 'post' | 'browser' | 'none'> => {
    if (info.oneClick && info.https) {
      await deps.unsubscribe.postOneClick(info.https);
      return 'post';
    }

    if (info.mailto) {
      await deps.unsubscribe.sendUnsubscribeEmail(info.mailto);
      return 'email';
    }

    if (info.https) {
      await deps.unsubscribe.openExternal(info.https);
      return 'browser';
    }

    return 'none';
  };
