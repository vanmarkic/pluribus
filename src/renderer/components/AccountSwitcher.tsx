/**
 * Account Switcher Component
 *
 * Displays current account with dropdown to switch between accounts.
 * Hidden when only one account exists.
 */

import { useState, useRef, useEffect } from 'react';
import { IconCheck } from 'obra-icons-react';
import { useAccountStore } from '../stores';

// Account color palette - deterministic based on email hash
const ACCOUNT_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#8B5CF6', // purple
  '#F59E0B', // amber
  '#EF4444', // red
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

function getAccountColor(email: string): string {
  const hash = email.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

type AccountAvatarProps = {
  email: string;
  size?: 'sm' | 'md';
};

function AccountAvatar({ email, size = 'sm' }: AccountAvatarProps) {
  const color = getAccountColor(email);
  const initial = email[0].toUpperCase();
  const sizeClasses = size === 'sm' ? 'w-5 h-5 text-xs' : 'w-8 h-8 text-sm';

  return (
    <div
      className={`${sizeClasses} rounded-full flex items-center justify-center font-medium text-white flex-shrink-0`}
      style={{ backgroundColor: color }}
    >
      {initial}
    </div>
  );
}

export function AccountSwitcher() {
  const { accounts, selectedAccountId, selectAccount, getSelectedAccount } = useAccountStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = getSelectedAccount();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Hide if single account or no accounts
  if (!selected || accounts.length <= 1) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger - plain text style */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md
                   hover:bg-[var(--color-bg-hover)] transition-colors"
      >
        <AccountAvatar email={selected.email} size="sm" />
        <span
          className="text-sm truncate flex-1 text-left"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {selected.email}
        </span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1
                      rounded-lg border shadow-lg z-50"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          {accounts.map(account => (
            <button
              key={account.id}
              onClick={() => {
                selectAccount(account.id);
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2
                         hover:bg-[var(--color-bg-hover)] first:rounded-t-lg last:rounded-b-lg"
            >
              <AccountAvatar email={account.email} size="sm" />
              <span className="text-sm truncate flex-1 text-left">{account.email}</span>
              {account.id === selectedAccountId && (
                <IconCheck className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
