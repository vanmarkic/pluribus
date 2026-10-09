/**
 * Notifier Adapter
 *
 * Native OS notifications. Placeholder until the Electron-backed
 * implementation lands: reports "unsupported" so callers skip notifying.
 */

import type { Notifier } from '../../core/ports';

export function createNotifier(): Notifier {
  return {
    // TODO(P2): back this with Electron's Notification (click -> open the Needs-your-reply view).
    isSupported: () => false,
    notify: () => {},
  };
}
