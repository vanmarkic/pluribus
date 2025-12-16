/**
 * License Activation Modal
 *
 * Allows users to enter and activate a license key.
 */

import { useState } from 'react';
import { IconClose, IconKey, IconSpinnerBall, IconCheck, IconCircleWarning } from 'obra-icons-react';
import { cn } from './ui/utils';
import { useLicenseStore } from '../stores';

export function LicenseActivationModal() {
  const { showActivationModal, closeActivationModal, activate, loading, error } = useLicenseStore();
  const [licenseKey, setLicenseKey] = useState('');
  const [warning, setWarning] = useState<string | null>(null);

  if (!showActivationModal) return null;

  const handleActivate = async () => {
    setWarning(null);
    const result = await activate(licenseKey.trim());
    if (result.success && result.warning) {
      setWarning(result.warning);
    }
  };

  const formatKey = (value: string) => {
    // Auto-format: PLRB-XXXX-XXXX-XXXX
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const parts = [];
    if (cleaned.length > 0) parts.push(cleaned.slice(0, 4));
    if (cleaned.length > 4) parts.push(cleaned.slice(4, 8));
    if (cleaned.length > 8) parts.push(cleaned.slice(8, 12));
    if (cleaned.length > 12) parts.push(cleaned.slice(12, 16));
    return parts.join('-');
  };

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatKey(e.target.value);
    setLicenseKey(formatted);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-gray-800 rounded-lg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <IconKey className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Activate License</h2>
          </div>
          <button
            onClick={closeActivationModal}
            className="p-1 rounded hover:bg-gray-700"
            disabled={loading}
          >
            <IconClose className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-gray-300 text-sm">
            Enter your license key to activate Pluribus Mail. You can find your license key in your purchase confirmation email.
          </p>

          <div>
            <label htmlFor="license-key" className="block text-sm font-medium text-gray-300 mb-1">
              License Key
            </label>
            <input
              id="license-key"
              type="text"
              value={licenseKey}
              onChange={handleKeyChange}
              placeholder="PLRB-XXXX-XXXX-XXXX"
              className={cn(
                'w-full px-3 py-2 rounded-md bg-gray-700 text-white placeholder-gray-500',
                'border focus:outline-none focus:ring-2 focus:ring-blue-500',
                error ? 'border-red-500' : 'border-gray-600'
              )}
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-red-900/30 border border-red-800">
              <IconCircleWarning className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {warning && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-yellow-900/30 border border-yellow-800">
              <IconCircleWarning className="w-4 h-4 text-yellow-400 flex-shrink-0" />
              <p className="text-sm text-yellow-300">{warning}</p>
            </div>
          )}

          <p className="text-xs text-gray-500">
            License is bound to this device. You can transfer it to a new device, but you won't be able to switch back.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t border-gray-700">
          <button
            onClick={closeActivationModal}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleActivate}
            disabled={loading || licenseKey.length < 19}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-md flex items-center gap-2',
              'bg-blue-600 text-white',
              (loading || licenseKey.length < 19) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-500'
            )}
          >
            {loading ? (
              <>
                <IconSpinnerBall className="w-4 h-4 animate-spin" />
                Activating...
              </>
            ) : (
              <>
                <IconCheck className="w-4 h-4" />
                Activate
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * License Status Badge
 *
 * Shows current license status in the sidebar/header.
 */
export function LicenseStatusBadge() {
  const { status, daysUntilExpiry, openActivationModal } = useLicenseStore();

  if (status === 'active' && daysUntilExpiry && daysUntilExpiry > 7) {
    // Don't show badge for healthy active licenses
    return null;
  }

  const badges: Record<string, { label: string; className: string; onClick?: () => void }> = {
    inactive: {
      label: 'Activate License',
      className: 'bg-blue-600 hover:bg-blue-500 cursor-pointer',
      onClick: openActivationModal,
    },
    active: {
      label: `${daysUntilExpiry} days left`,
      className: 'bg-yellow-600',
    },
    grace: {
      label: `Grace period (${Math.abs(daysUntilExpiry || 0)} days)`,
      className: 'bg-orange-600',
    },
    expired: {
      label: 'License expired (Read-only)',
      className: 'bg-red-600',
      onClick: openActivationModal,
    },
  };

  const badge = badges[status];
  if (!badge) return null;

  return (
    <button
      onClick={badge.onClick}
      className={cn(
        'px-2 py-1 text-xs font-medium rounded text-white',
        badge.className
      )}
    >
      {badge.label}
    </button>
  );
}
