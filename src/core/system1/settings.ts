/**
 * Reads System 1 settings from the config port, filling any missing field
 * (older stores, test mocks) from the defaults.
 */

import { DEFAULT_SYSTEM1_SETTINGS, type System1Settings } from '../domain';
import type { ConfigStore } from '../ports';

export function readSystem1Settings(
  config: Pick<ConfigStore, 'getSystem1Settings'>,
): System1Settings {
  return { ...DEFAULT_SYSTEM1_SETTINGS, ...config.getSystem1Settings?.() };
}
