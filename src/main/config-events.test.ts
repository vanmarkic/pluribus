import { describe, it, expect, vi } from 'vitest';
import { createConfigEvents } from './config-events';

type Config = { digest: { launchAtLogin: boolean }; llm: { model: string } };

describe('createConfigEvents', () => {
  it('tells the listeners of a key about its new value', () => {
    const events = createConfigEvents<Config>();
    const digest = vi.fn();
    const llm = vi.fn();
    events.onChange('digest', digest);
    events.onChange('llm', llm);

    events.emit('digest', { launchAtLogin: false });

    expect(digest).toHaveBeenCalledWith({ launchAtLogin: false });
    expect(llm).not.toHaveBeenCalled();
  });

  it('supports several listeners on one key and unsubscribing', () => {
    const events = createConfigEvents<Config>();
    const a = vi.fn();
    const b = vi.fn();
    const offA = events.onChange('digest', a);
    events.onChange('digest', b);

    events.emit('digest', { launchAtLogin: true });
    offA();
    events.emit('digest', { launchAtLogin: false });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('does nothing when nobody listens', () => {
    const events = createConfigEvents<Config>();
    expect(() => events.emit('llm', { model: 'x' })).not.toThrow();
  });

  it('keeps notifying the others when one listener throws, and reports it', () => {
    const onError = vi.fn();
    const events = createConfigEvents<Config>(onError);
    const boom = new Error('boom');
    const after = vi.fn();
    events.onChange('digest', () => {
      throw boom;
    });
    events.onChange('digest', after);

    expect(() => events.emit('digest', { launchAtLogin: true })).not.toThrow();

    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('digest', boom);
  });

  it('lets a listener unsubscribe itself while being notified', () => {
    const events = createConfigEvents<Config>();
    const second = vi.fn();
    const off = events.onChange('digest', () => off());
    events.onChange('digest', second);

    events.emit('digest', { launchAtLogin: true });
    events.emit('digest', { launchAtLogin: true });

    expect(second).toHaveBeenCalledTimes(2);
  });
});
