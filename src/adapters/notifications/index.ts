/**
 * Notifier Adapter
 *
 * Native OS notifications via Electron's Notification. Used by the daily
 * "Needs your reply" digest: clicking the notification opens that view.
 *
 * Electron-only pieces are injectable (`NotificationCtor`) so the adapter can be
 * unit-tested without Electron.
 */

import { Notification as ElectronNotification } from 'electron';
import type { Notifier } from '../../core/ports';

export type NotifierOptions = {
  /** Invoked when a notification is clicked and it has no onClick of its own. */
  onClickDefault?: () => void;
  /** Injectable for tests. Defaults to Electron's Notification. */
  NotificationCtor?: typeof ElectronNotification;
};

// 'close' is not emitted on every platform, so cap what we hold on to.
const MAX_LIVE_NOTIFICATIONS = 20;

export function createNotifier(opts: NotifierOptions = {}): Notifier {
  const Ctor = opts.NotificationCtor ?? ElectronNotification;

  // Electron may garbage-collect a Notification (and silently drop its click
  // handler) once nothing references it. Hold on to each one until it is
  // closed, clicked or has failed.
  const live = new Set<InstanceType<typeof ElectronNotification>>();

  return {
    isSupported: () => Ctor.isSupported(),

    notify({ title, body, onClick }) {
      if (!Ctor.isSupported()) return;

      try {
        const notification = new Ctor({ title, body });

        const release = () => {
          live.delete(notification);
        };
        notification.on('click', () => {
          release();
          try {
            (onClick ?? opts.onClickDefault)?.();
          } catch (err) {
            console.error('[notifier] Click handler failed:', err);
          }
        });
        notification.on('close', release);
        notification.on('failed', release);

        live.add(notification);
        if (live.size > MAX_LIVE_NOTIFICATIONS) {
          const oldest = live.values().next().value;
          if (oldest !== undefined) live.delete(oldest);
        }

        notification.show();
      } catch (err) {
        console.error('[notifier] Could not show notification:', err);
      }
    },
  };
}
