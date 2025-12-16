/**
 * Contact Autocomplete
 *
 * Autocomplete input for email addresses with recent contacts.
 * Shows top 5 on focus, filters as you type.
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from './ui/utils';
import type { RecentContact } from '../../core/domain';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
};

export function ContactAutocomplete({ value, onChange, placeholder, label }: Props) {
  const [suggestions, setSuggestions] = useState<RecentContact[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load suggestions on focus or typing
  const loadSuggestions = async (inputValue?: string) => {
    try {
      // Use provided value or current value
      const currentValue = inputValue ?? value;
      const parts = currentValue.split(',');
      const segment = parts[parts.length - 1].trim();

      const results = segment.length > 0
        ? await window.mailApi.contacts.search(segment, 5)
        : await window.mailApi.contacts.getRecent(5);
      setSuggestions(results);
      setHighlightIndex(0);
    } catch (err) {
      console.error('Failed to load contacts:', err);
      setSuggestions([]);
    }
  };

  // Handle selection
  const selectContact = (contact: RecentContact) => {
    const parts = value.split(',').map(p => p.trim()).filter(Boolean);
    parts.pop(); // Remove current incomplete segment
    parts.push(contact.address);
    onChange(parts.join(', ') + (parts.length > 0 ? ', ' : ''));
    setShowDropdown(false);
    inputRef.current?.focus();
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestions[highlightIndex]) {
        e.preventDefault();
        selectContact(suggestions[highlightIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (showDropdown && dropdownRef.current) {
      const highlighted = dropdownRef.current.children[highlightIndex] as HTMLElement;
      highlighted?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex, showDropdown]);

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => {
          const newValue = e.target.value;
          onChange(newValue);
          loadSuggestions(newValue);
          setShowDropdown(true);
        }}
        onFocus={() => {
          setShowDropdown(true);
          loadSuggestions();
        }}
        onBlur={() => {
          // Delay to allow click on dropdown
          setTimeout(() => setShowDropdown(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full outline-none text-sm bg-transparent"
        style={{ color: 'var(--color-text-primary)' }}
        aria-label={label}
      />

      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto"
        >
          {suggestions.map((contact, i) => (
            <button
              key={contact.address}
              type="button"
              onMouseDown={e => e.preventDefault()} // Prevent blur
              onMouseEnter={() => setHighlightIndex(i)}
              onClick={() => selectContact(contact)}
              className={cn(
                'w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 transition-colors',
                i === highlightIndex && 'bg-blue-50 border-l-2 border-blue-500'
              )}
            >
              <div className="font-medium truncate">
                {contact.name || contact.address}
              </div>
              {contact.name && (
                <div className="text-zinc-500 text-xs truncate">{contact.address}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
