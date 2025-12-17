import { useEffect } from 'react';
import { useAccountStore, useUIStore } from '../../stores';

/**
 * Account Settings Component
 * Manages email account configuration
 */
export function AccountSettings() {
  const { accounts, loadAccounts } = useAccountStore();
  const { openAccountWizard } = useUIStore();

  useEffect(() => {
    loadAccounts();
  }, []);

  if (accounts.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="mb-4" style={{ color: 'var(--color-text-tertiary)' }}>
          No accounts configured
        </p>
        <button onClick={() => openAccountWizard()} className="btn btn-primary">
          Add Account
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {accounts.map(account => (
        <div
          key={account.id}
          className="flex items-center justify-between p-4 border rounded-lg"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div>
            <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {account.name || account.email}
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              {account.email} • {account.isActive ? 'Active' : 'Inactive'}
            </div>
          </div>
          <button
            onClick={() => openAccountWizard(account.id)}
            className="btn btn-ghost text-sm"
          >
            Edit
          </button>
        </div>
      ))}

      <button
        onClick={() => openAccountWizard()}
        className="w-full py-2 text-sm rounded-lg"
        style={{ color: 'var(--color-accent)' }}
      >
        + Add another account
      </button>
    </div>
  );
}
