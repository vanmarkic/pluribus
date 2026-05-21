/**
 * License Service Adapter
 *
 * Handles license validation with the license server.
 * Uses Electron's safeStorage for secure token persistence.
 */

import { createHash } from 'crypto';
import { machineIdSync } from 'node-machine-id';
import { app, safeStorage } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import type { LicenseService, ActivationResult } from '../../core/ports';
import type { LicenseState, LicenseStatus } from '../../core/domain';
import { LICENSE_GRACE_PERIOD_DAYS } from '../../core/domain';

// Server URL - could be made configurable
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || 'https://46.224.43.248:3001';

/**
 * Reject a non-HTTPS license endpoint. License validation carries the
 * license key and a machine identifier; over plain HTTP a network
 * attacker can read both and forge a "valid" response. Plain-HTTP
 * loopback is permitted for local development only.
 */
function assertSecureLicenseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid LICENSE_SERVER_URL');
  }
  if (url.protocol === 'https:') return url;
  const host = url.hostname;
  if (
    url.protocol === 'http:' &&
    (host === 'localhost' || host === '127.0.0.1' || host === '::1')
  ) {
    return url;
  }
  throw new Error('License server must be reachable over HTTPS');
}

// Local storage file for license data
const LICENSE_FILE = 'license.enc';

type StoredLicense = {
  licenseKey: string;
  token: string;
  expiresAt: string;
  lastValidated: string;
};

type ValidationResponse =
  | { valid: true; expiresAt: string; token: string }
  | { valid: true; warning: 'device_changed'; message: string; expiresAt: string; token: string }
  | { valid: false; reason: string };

function getMachineId(): string {
  // Get unique machine identifier and hash it for privacy
  // Note: machineIdSync accepts {original: true} but types say boolean
  const rawId = machineIdSync(true);
  return createHash('sha256').update(rawId).digest('hex');
}

function getLicenseFilePath(): string {
  return join(app.getPath('userData'), LICENSE_FILE);
}

function loadStoredLicense(): StoredLicense | null {
  const filePath = getLicenseFilePath();
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const encryptedData = readFileSync(filePath);
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('Safe storage not available, license data may be compromised');
      return JSON.parse(encryptedData.toString());
    }
    const decrypted = safeStorage.decryptString(encryptedData);
    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Failed to load stored license:', error);
    return null;
  }
}

function saveStoredLicense(license: StoredLicense): void {
  const filePath = getLicenseFilePath();
  const json = JSON.stringify(license);

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    writeFileSync(filePath, encrypted);
  } else {
    console.warn('Safe storage not available, storing license unencrypted');
    writeFileSync(filePath, json);
  }
}

function clearStoredLicense(): void {
  const filePath = getLicenseFilePath();
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

function calculateLicenseStatus(expiresAt: Date | null): {
  status: LicenseStatus;
  isReadOnly: boolean;
  daysUntilExpiry: number | null;
} {
  if (!expiresAt) {
    return { status: 'inactive', isReadOnly: false, daysUntilExpiry: null };
  }

  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry > 0) {
    return { status: 'active', isReadOnly: false, daysUntilExpiry };
  }

  if (daysUntilExpiry > -LICENSE_GRACE_PERIOD_DAYS) {
    return { status: 'grace', isReadOnly: false, daysUntilExpiry };
  }

  return { status: 'expired', isReadOnly: true, daysUntilExpiry };
}

export function createLicenseService(): LicenseService {
  const listeners = new Set<(state: LicenseState) => void>();

  // Default to active with 1 year expiry (development mode)
  const defaultExpiry = new Date();
  defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);

  let cachedState: LicenseState = {
    status: 'active',
    licenseKey: 'DEV-LICENSE',
    expiresAt: defaultExpiry,
    daysUntilExpiry: 365,
    isReadOnly: false,
  };

  // Override with stored license if available
  const stored = loadStoredLicense();
  if (stored) {
    const expiresAt = new Date(stored.expiresAt);
    const { status, isReadOnly, daysUntilExpiry } = calculateLicenseStatus(expiresAt);
    cachedState = {
      status,
      licenseKey: stored.licenseKey,
      expiresAt,
      daysUntilExpiry,
      isReadOnly,
    };
  }

  function notifyListeners(): void {
    for (const listener of listeners) {
      listener(cachedState);
    }
  }

  async function callServer(licenseKey: string): Promise<ValidationResponse> {
    const machineId = getMachineId();
    const base = assertSecureLicenseUrl(LICENSE_SERVER_URL);

    const response = await fetch(new URL('/api/license/validate', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: licenseKey, machineId }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    return response.json() as Promise<ValidationResponse>;
  }

  return {
    getState(): LicenseState {
      // Recalculate status on each call (time-based)
      if (cachedState.expiresAt) {
        const { status, isReadOnly, daysUntilExpiry } = calculateLicenseStatus(
          cachedState.expiresAt,
        );
        cachedState = { ...cachedState, status, isReadOnly, daysUntilExpiry };
      }
      return cachedState;
    },

    async activate(licenseKey: string): Promise<ActivationResult> {
      try {
        const result = await callServer(licenseKey);

        if (!result.valid) {
          return { success: false, error: result.reason };
        }

        const expiresAt = new Date(result.expiresAt);

        // Save license locally
        saveStoredLicense({
          licenseKey,
          token: result.token,
          expiresAt: result.expiresAt,
          lastValidated: new Date().toISOString(),
        });

        // Update state
        const { status, isReadOnly, daysUntilExpiry } = calculateLicenseStatus(expiresAt);
        cachedState = {
          status,
          licenseKey,
          expiresAt,
          daysUntilExpiry,
          isReadOnly,
        };
        notifyListeners();

        if ('warning' in result && result.warning === 'device_changed') {
          return { success: true, warning: 'device_changed', message: result.message, expiresAt };
        }

        return { success: true, expiresAt };
      } catch (error) {
        console.error('License activation failed:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    },

    async validate(): Promise<ActivationResult> {
      const stored = loadStoredLicense();
      if (!stored) {
        return { success: false, error: 'No license key stored' };
      }

      return this.activate(stored.licenseKey);
    },

    async deactivate(): Promise<void> {
      clearStoredLicense();
      cachedState = {
        status: 'inactive',
        licenseKey: null,
        expiresAt: null,
        daysUntilExpiry: null,
        isReadOnly: false,
      };
      notifyListeners();
    },

    onStateChange(cb: (state: LicenseState) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
