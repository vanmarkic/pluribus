import { describe, it, expect, vi } from 'vitest';
import {
  createActivationGuard,
  createLoginItemController,
  createLoginItemSync,
  HIDDEN_ARG,
  HIDDEN_START_QUIET_MS,
  type LoginItemApp,
} from './login-item';
import type { DigestState } from '../core/domain';

function fakeApp(
  over: {
    isPackaged?: boolean;
    openAtLogin?: boolean;
    wasOpenedAtLogin?: boolean;
    setThrows?: boolean;
    getThrows?: boolean;
  } = {},
) {
  let openAtLogin = over.openAtLogin ?? false;
  const setLoginItemSettings = vi.fn((s: { openAtLogin: boolean; args?: string[] }) => {
    if (over.setThrows) throw new Error('denied');
    openAtLogin = s.openAtLogin;
  });
  const getLoginItemSettings = vi.fn((_options?: { args?: string[] }) => {
    if (over.getThrows) throw new Error('unreadable');
    return { openAtLogin, wasOpenedAtLogin: over.wasOpenedAtLogin ?? false };
  });
  const app: LoginItemApp = {
    isPackaged: over.isPackaged ?? true,
    setLoginItemSettings,
    getLoginItemSettings,
  };
  return { app, setLoginItemSettings, getLoginItemSettings };
}

describe('login item controller: apply', () => {
  it('registers the login item on macOS', () => {
    const { app, setLoginItemSettings } = fakeApp();
    const controller = createLoginItemController({ app, platform: 'darwin' });

    expect(controller.apply(true)).toBe('applied');
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('removes the login item when turned off', () => {
    const { app, setLoginItemSettings } = fakeApp({ openAtLogin: true });
    const controller = createLoginItemController({ app, platform: 'darwin' });

    expect(controller.apply(false)).toBe('applied');
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });

  it('carries the --hidden argument on Windows, for both the write and the read', () => {
    const { app, setLoginItemSettings, getLoginItemSettings } = fakeApp();
    const controller = createLoginItemController({ app, platform: 'win32' });

    expect(controller.apply(true)).toBe('applied');
    expect(getLoginItemSettings).toHaveBeenCalledWith({ args: [HIDDEN_ARG] });
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: [HIDDEN_ARG] });
  });

  it('does not write when the OS already has the wanted state', () => {
    const { app, setLoginItemSettings } = fakeApp({ openAtLogin: true });
    const controller = createLoginItemController({ app, platform: 'darwin' });

    expect(controller.apply(true)).toBe('unchanged');
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it.each(['linux', 'freebsd', 'aix'])('does nothing on %s (no login-item API)', (platform) => {
    const { app, setLoginItemSettings, getLoginItemSettings } = fakeApp();
    const controller = createLoginItemController({ app, platform });

    expect(controller.apply(true)).toBe('unsupported');
    expect(setLoginItemSettings).not.toHaveBeenCalled();
    expect(getLoginItemSettings).not.toHaveBeenCalled();
  });

  it('never registers the development binary', () => {
    const { app, setLoginItemSettings } = fakeApp({ isPackaged: false });
    const controller = createLoginItemController({ app, platform: 'darwin' });

    expect(controller.apply(true)).toBe('not-packaged');
    expect(setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('reports a failure instead of throwing, and logs it', () => {
    const log = vi.fn();
    const { app } = fakeApp({ setThrows: true });
    const controller = createLoginItemController({ app, platform: 'darwin', log });

    expect(controller.apply(true)).toBe('failed');
    expect(log).toHaveBeenCalledOnce();
  });

  it('reports a failure when the current state cannot be read', () => {
    const { app } = fakeApp({ getThrows: true });
    const controller = createLoginItemController({ app, platform: 'win32' });

    expect(controller.apply(true)).toBe('failed');
  });
});

describe('login item controller: openedAtLogin', () => {
  it('uses the OS flag on macOS', () => {
    const yes = createLoginItemController({
      app: fakeApp({ wasOpenedAtLogin: true }).app,
      platform: 'darwin',
    });
    const no = createLoginItemController({
      app: fakeApp({ wasOpenedAtLogin: false }).app,
      platform: 'darwin',
    });

    expect(yes.openedAtLogin()).toBe(true);
    expect(no.openedAtLogin()).toBe(false);
  });

  it('uses the --hidden argument on Windows (there is no OS flag)', () => {
    const app = fakeApp({ wasOpenedAtLogin: true }).app;

    expect(
      createLoginItemController({
        app,
        platform: 'win32',
        argv: ['app.exe', HIDDEN_ARG],
      }).openedAtLogin(),
    ).toBe(true);
    expect(
      createLoginItemController({ app, platform: 'win32', argv: ['app.exe'] }).openedAtLogin(),
    ).toBe(false);
  });

  it('is false on other platforms, even with the argument', () => {
    const controller = createLoginItemController({
      app: fakeApp({ wasOpenedAtLogin: true }).app,
      platform: 'linux',
      argv: [HIDDEN_ARG],
    });

    expect(controller.openedAtLogin()).toBe(false);
  });

  it('is false (never throws) when the OS state cannot be read', () => {
    const log = vi.fn();
    const controller = createLoginItemController({
      app: fakeApp({ getThrows: true }).app,
      platform: 'darwin',
      log,
    });

    expect(controller.openedAtLogin()).toBe(false);
    expect(log).toHaveBeenCalledOnce();
  });
});

describe('login item sync', () => {
  function harness(
    over: {
      launchAtLogin?: boolean;
      state?: Partial<DigestState>;
      platform?: string;
      isPackaged?: boolean;
      openAtLogin?: boolean;
      wasOpenedAtLogin?: boolean;
    } = {},
  ) {
    const fake = fakeApp({
      isPackaged: over.isPackaged,
      openAtLogin: over.openAtLogin,
      wasOpenedAtLogin: over.wasOpenedAtLogin,
    });
    const controller = createLoginItemController({
      app: fake.app,
      platform: over.platform ?? 'darwin',
    });
    let state: DigestState = {
      lastRunDate: '2026-10-08',
      pendingEmailAccountIds: [3],
      ...over.state,
    };
    let launchAtLogin = over.launchAtLogin ?? true;
    const setState = vi.fn((next: DigestState) => {
      state = next;
    });
    const sync = createLoginItemSync({
      controller,
      getSettings: () => ({ launchAtLogin }),
      getState: () => state,
      setState,
    });
    return {
      sync,
      fake,
      setState,
      getState: () => state,
      setLaunchAtLogin: (value: boolean) => {
        launchAtLogin = value;
      },
    };
  }

  describe('reconcileAtStartup', () => {
    it('applies the stored setting on the first packaged launch and remembers it', () => {
      const h = harness();

      expect(h.sync.reconcileAtStartup()).toBe('applied');
      expect(h.fake.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
      expect(h.getState().loginItemApplied).toBe(true);
    });

    it('keeps the other digest state fields when it records that it applied', () => {
      const h = harness();

      h.sync.reconcileAtStartup();

      expect(h.getState()).toEqual({
        lastRunDate: '2026-10-08',
        pendingEmailAccountIds: [3],
        loginItemApplied: true,
      });
    });

    it('does not touch the OS again once applied (a removal in System Settings is respected)', () => {
      const h = harness({ state: { loginItemApplied: true } });

      expect(h.sync.reconcileAtStartup()).toBe('skipped');
      expect(h.fake.setLoginItemSettings).not.toHaveBeenCalled();
      expect(h.fake.getLoginItemSettings).not.toHaveBeenCalled();
      expect(h.setState).not.toHaveBeenCalled();
    });

    it('also records it when the OS already had the wanted state', () => {
      const h = harness({ openAtLogin: true });

      expect(h.sync.reconcileAtStartup()).toBe('unchanged');
      expect(h.getState().loginItemApplied).toBe(true);
    });

    it('applies the OFF setting too on the first launch', () => {
      const h = harness({ launchAtLogin: false, openAtLogin: true });

      expect(h.sync.reconcileAtStartup()).toBe('applied');
      expect(h.fake.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
    });

    it.each([
      ['a development build', { isPackaged: false }],
      ['Linux', { platform: 'linux' }],
    ])('does not record anything on %s, so a later real launch still applies it', (_name, over) => {
      const h = harness(over);

      h.sync.reconcileAtStartup();

      expect(h.setState).not.toHaveBeenCalled();
      expect(h.getState().loginItemApplied).toBeUndefined();
    });

    it('does not record a failure, so the next launch tries again', () => {
      const failing = fakeApp({ setThrows: true });
      let state: DigestState = { lastRunDate: null, pendingEmailAccountIds: [] };
      const setState = vi.fn((next: DigestState) => {
        state = next;
      });
      const sync = createLoginItemSync({
        controller: createLoginItemController({ app: failing.app, platform: 'darwin' }),
        getSettings: () => ({ launchAtLogin: true }),
        getState: () => state,
        setState,
      });

      expect(sync.reconcileAtStartup()).toBe('failed');
      expect(setState).not.toHaveBeenCalled();
    });
  });

  describe('onSettingsChanged', () => {
    it('applies the new value right away and marks the setting as applied', () => {
      const h = harness({ openAtLogin: true });

      expect(h.sync.onSettingsChanged({ launchAtLogin: false })).toBe('applied');
      expect(h.fake.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
      expect(h.getState().loginItemApplied).toBe(true);
    });

    it('re-applies after the user toggled it, even if startup had applied it before', () => {
      const h = harness({ state: { loginItemApplied: true }, openAtLogin: false });

      expect(h.sync.onSettingsChanged({ launchAtLogin: true })).toBe('applied');
      expect(h.fake.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    });

    it('writes the state only once', () => {
      const h = harness({ state: { loginItemApplied: true }, openAtLogin: true });

      expect(h.sync.onSettingsChanged({ launchAtLogin: true })).toBe('unchanged');
      expect(h.setState).not.toHaveBeenCalled();
    });

    it('does not mark anything on an unsupported platform', () => {
      const h = harness({ platform: 'linux' });

      expect(h.sync.onSettingsChanged({ launchAtLogin: true })).toBe('unsupported');
      expect(h.setState).not.toHaveBeenCalled();
    });
  });

  describe('shouldStartHidden', () => {
    it('is true when the OS started us at login and the user wants that', () => {
      expect(
        harness({ wasOpenedAtLogin: true, launchAtLogin: true }).sync.shouldStartHidden(),
      ).toBe(true);
    });

    it('is false for a normal launch', () => {
      expect(
        harness({ wasOpenedAtLogin: false, launchAtLogin: true }).sync.shouldStartHidden(),
      ).toBe(false);
    });

    it('is false when the setting is off, even if the OS started us at login', () => {
      // The user turned it off but the OS item is still there: show the window.
      expect(
        harness({ wasOpenedAtLogin: true, launchAtLogin: false }).sync.shouldStartHidden(),
      ).toBe(false);
    });

    it('follows the setting as it changes', () => {
      const h = harness({ wasOpenedAtLogin: true, launchAtLogin: true });
      expect(h.sync.shouldStartHidden()).toBe(true);

      h.setLaunchAtLogin(false);

      expect(h.sync.shouldStartHidden()).toBe(false);
    });
  });
});

describe('activation guard', () => {
  it('ignores nothing until it is armed (a normal launch)', () => {
    const guard = createActivationGuard(() => 0);
    expect(guard.shouldIgnoreActivation()).toBe(false);
  });

  it('ignores activations during the quiet period after a hidden start', () => {
    let t = 10_000;
    const guard = createActivationGuard(() => t, 3000);
    guard.arm();

    t += 100;
    expect(guard.shouldIgnoreActivation()).toBe(true);
    t += 2899;
    expect(guard.shouldIgnoreActivation()).toBe(true);
  });

  it('lets a later dock click through', () => {
    let t = 10_000;
    const guard = createActivationGuard(() => t, 3000);
    guard.arm();

    t += 3000;
    expect(guard.shouldIgnoreActivation()).toBe(false);
  });

  it('has a quiet period of a few seconds by default', () => {
    expect(HIDDEN_START_QUIET_MS).toBeGreaterThanOrEqual(1000);
    expect(HIDDEN_START_QUIET_MS).toBeLessThanOrEqual(10_000);
  });
});
