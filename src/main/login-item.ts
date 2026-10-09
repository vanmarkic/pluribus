/**
 * Launch at login, window hidden (macOS and Windows).
 *
 * The daily digest only fires while the app runs, so the app can register
 * itself as a login item and then start WITHOUT a window (the container, the
 * IPC handlers and the digest runtime still start; a dock click or a second
 * launch opens the window).
 *
 * Electron is injected (`LoginItemApp`) so everything here runs under vitest.
 * Nothing in this file touches mail, credentials or the network.
 *
 * Limits that cannot be tested without a real OS (see the design doc):
 * - macOS 13+ may list the app under System Settings -> Login Items and ask
 *   the user to allow it; an ad-hoc-signed, non-notarized app may be treated
 *   more strictly.
 * - Electron has no login-item API on Linux; the setting does nothing there.
 */

import type { DigestSettings, DigestState } from '../core/domain';

/** The slice of Electron's `app` this module uses (structurally compatible). */
export type LoginItemApp = {
  isPackaged: boolean;
  setLoginItemSettings: (settings: { openAtLogin: boolean; args?: string[] }) => void;
  getLoginItemSettings: (options?: { args?: string[] }) => {
    openAtLogin: boolean;
    wasOpenedAtLogin?: boolean;
  };
};

export type LoginItemResult = 'applied' | 'unchanged' | 'unsupported' | 'not-packaged' | 'failed';

export type LoginItemController = {
  /** Register or remove the login item. Never throws. */
  apply: (enabled: boolean) => LoginItemResult;
  /** True when this process was started by the OS at login. */
  openedAtLogin: () => boolean;
};

/** Windows has no "was opened at login" flag, so the login item carries this argument. */
export const HIDDEN_ARG = '--hidden';

export const isLoginItemPlatform = (platform: string): boolean =>
  platform === 'darwin' || platform === 'win32';

export function createLoginItemController(opts: {
  app: LoginItemApp;
  platform?: string;
  argv?: readonly string[];
  log?: (message: string, error?: unknown) => void;
}): LoginItemController {
  const platform = opts.platform ?? process.platform;
  const argv = opts.argv ?? process.argv;
  const log = opts.log ?? (() => {});
  // Only Windows needs the argument; on macOS the OS reports a login start itself.
  const args = platform === 'win32' ? [HIDDEN_ARG] : undefined;
  const withArgs = args ? { args } : {};

  return {
    apply(enabled) {
      if (!isLoginItemPlatform(platform)) return 'unsupported';
      // Never register the development Electron binary as a login item.
      if (!opts.app.isPackaged) return 'not-packaged';
      try {
        if (opts.app.getLoginItemSettings(withArgs).openAtLogin === enabled) return 'unchanged';
        opts.app.setLoginItemSettings({ openAtLogin: enabled, ...withArgs });
        return 'applied';
      } catch (error) {
        log('Could not update the login item', error);
        return 'failed';
      }
    },

    openedAtLogin() {
      try {
        if (platform === 'darwin') return opts.app.getLoginItemSettings().wasOpenedAtLogin === true;
        if (platform === 'win32') return argv.includes(HIDDEN_ARG);
      } catch (error) {
        log('Could not read the login item state', error);
      }
      return false;
    },
  };
}

// ============================================
// Startup + settings-change glue
// ============================================

export type LoginItemSync = {
  /**
   * At startup: apply the stored setting ONCE (first packaged launch). After
   * that the OS state is left alone, so a user who removed the login item in
   * System Settings is not overruled on every launch.
   */
  reconcileAtStartup: () => LoginItemResult | 'skipped';
  /** The user changed the digest settings: apply `launchAtLogin` right away. */
  onSettingsChanged: (next: Pick<DigestSettings, 'launchAtLogin'>) => LoginItemResult;
  /** Start without a window: the OS launched us at login and the user wants that. */
  shouldStartHidden: () => boolean;
};

const settled = (result: LoginItemResult): boolean =>
  result === 'applied' || result === 'unchanged';

export function createLoginItemSync(opts: {
  controller: LoginItemController;
  getSettings: () => Pick<DigestSettings, 'launchAtLogin'>;
  getState: () => DigestState;
  setState: (state: DigestState) => void;
}): LoginItemSync {
  const markApplied = (): void => {
    const state = opts.getState();
    if (!state.loginItemApplied) opts.setState({ ...state, loginItemApplied: true });
  };

  return {
    reconcileAtStartup() {
      if (opts.getState().loginItemApplied) return 'skipped';
      const result = opts.controller.apply(opts.getSettings().launchAtLogin);
      // Dev builds, Linux and failures are not recorded: try again next time.
      if (settled(result)) markApplied();
      return result;
    },

    onSettingsChanged(next) {
      const result = opts.controller.apply(next.launchAtLogin);
      if (settled(result)) markApplied();
      return result;
    },

    shouldStartHidden() {
      return opts.getSettings().launchAtLogin && opts.controller.openedAtLogin();
    },
  };
}

// ============================================
// Launch-time activation guard
// ============================================

/**
 * macOS may emit `activate` while it launches the app, which would open the
 * window we just decided not to create. After a hidden start, activations in
 * the first few seconds are ignored; a real dock click comes later (and a
 * second launch goes through `second-instance`, which is never ignored).
 */
export const HIDDEN_START_QUIET_MS = 3000;

export type ActivationGuard = {
  /** Call once the hidden start is complete. */
  arm: () => void;
  shouldIgnoreActivation: () => boolean;
};

export function createActivationGuard(
  now: () => number = Date.now,
  quietMs: number = HIDDEN_START_QUIET_MS,
): ActivationGuard {
  let armedAt: number | null = null;
  return {
    arm() {
      armedAt = now();
    },
    shouldIgnoreActivation() {
      return armedAt !== null && now() - armedAt < quietMs;
    },
  };
}
