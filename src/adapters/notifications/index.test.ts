import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => {
  class Notification {
    static isSupported = () => true;
  }
  return { Notification };
});

import { createNotifier } from './index';

type Handler = (...args: unknown[]) => void;

/** Minimal stand-in for Electron's Notification: records options and listeners. */
function makeFakeNotificationCtor() {
  const instances: FakeNotification[] = [];
  const state = { supported: true, showError: null as Error | null };

  class FakeNotification {
    static isSupported = vi.fn(() => state.supported);
    handlers = new Map<string, Handler[]>();
    show = vi.fn(() => {
      if (state.showError) throw state.showError;
    });
    constructor(public options: { title: string; body: string }) {
      instances.push(this);
    }
    on(event: string, handler: Handler) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string) {
      for (const h of this.handlers.get(event) ?? []) h();
    }
  }

  return {
    Ctor: FakeNotification as unknown as typeof Electron.Notification,
    instances,
    state,
    isSupported: FakeNotification.isSupported,
  };
}

describe('createNotifier', () => {
  let fake: ReturnType<typeof makeFakeNotificationCtor>;

  beforeEach(() => {
    fake = makeFakeNotificationCtor();
  });

  it('isSupported() delegates to Notification.isSupported()', () => {
    const notifier = createNotifier({ NotificationCtor: fake.Ctor });
    expect(notifier.isSupported()).toBe(true);
    fake.state.supported = false;
    expect(notifier.isSupported()).toBe(false);
    expect(fake.isSupported).toHaveBeenCalledTimes(2);
  });

  it('shows a notification with the given title and body', () => {
    const notifier = createNotifier({ NotificationCtor: fake.Ctor });
    notifier.notify({
      title: 'Needs your reply',
      body: '3 important emails are waiting for your reply',
    });

    expect(fake.instances).toHaveLength(1);
    expect(fake.instances[0]?.options).toMatchObject({
      title: 'Needs your reply',
      body: '3 important emails are waiting for your reply',
    });
    expect(fake.instances[0]?.show).toHaveBeenCalledTimes(1);
  });

  it('click invokes the per-notification onClick', () => {
    const onClick = vi.fn();
    const onClickDefault = vi.fn();
    const notifier = createNotifier({ NotificationCtor: fake.Ctor, onClickDefault });
    notifier.notify({ title: 't', body: 'b', onClick });

    fake.instances[0]?.emit('click');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClickDefault).not.toHaveBeenCalled();
  });

  it('click falls back to onClickDefault when there is no onClick', () => {
    const onClickDefault = vi.fn();
    const notifier = createNotifier({ NotificationCtor: fake.Ctor, onClickDefault });
    notifier.notify({ title: 't', body: 'b' });

    fake.instances[0]?.emit('click');
    expect(onClickDefault).toHaveBeenCalledTimes(1);
  });

  it('click with no handlers at all is harmless', () => {
    const notifier = createNotifier({ NotificationCtor: fake.Ctor });
    notifier.notify({ title: 't', body: 'b' });
    expect(() => fake.instances[0]?.emit('click')).not.toThrow();
  });

  it('a throwing click handler does not propagate into Electron', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const notifier = createNotifier({
      NotificationCtor: fake.Ctor,
      onClickDefault: () => {
        throw new Error('window gone');
      },
    });
    notifier.notify({ title: 't', body: 'b' });
    expect(() => fake.instances[0]?.emit('click')).not.toThrow();
    spy.mockRestore();
  });

  it('is a no-op when notifications are not supported', () => {
    fake.state.supported = false;
    const notifier = createNotifier({ NotificationCtor: fake.Ctor });
    notifier.notify({ title: 't', body: 'b' });
    expect(fake.instances).toHaveLength(0);
  });

  it('does not throw when Electron fails to show the notification', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.state.showError = new Error('dbus unavailable');
    const notifier = createNotifier({ NotificationCtor: fake.Ctor });
    expect(() => notifier.notify({ title: 't', body: 'b' })).not.toThrow();
    spy.mockRestore();
  });

  it('wires close/failed so the held reference is released (and those events are safe)', () => {
    const notifier = createNotifier({ NotificationCtor: fake.Ctor });
    notifier.notify({ title: 't', body: 'b' });
    const n = fake.instances[0];
    expect(n?.handlers.has('close')).toBe(true);
    expect(n?.handlers.has('failed')).toBe(true);
    expect(() => n?.emit('close')).not.toThrow();
    expect(() => n?.emit('failed')).not.toThrow();
  });

  it('keeps notifications working after many shown without a close event', () => {
    const onClickDefault = vi.fn();
    const notifier = createNotifier({ NotificationCtor: fake.Ctor, onClickDefault });
    for (let i = 0; i < 100; i++) notifier.notify({ title: `t${i}`, body: 'b' });
    fake.instances[99]?.emit('click');
    expect(onClickDefault).toHaveBeenCalledTimes(1);
  });

  it('defaults to the Electron Notification when no constructor is injected', () => {
    // The vi.mock('electron') above provides a Notification whose isSupported() is true.
    const notifier = createNotifier();
    expect(notifier.isSupported()).toBe(true);
  });
});
