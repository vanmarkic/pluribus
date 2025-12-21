/**
 * Tests for useEmailListKeyboard hook
 *
 * Tests keyboard navigation, selection, and action shortcuts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmailListKeyboard } from './useEmailListKeyboard';
import { useEmailStore, useUIStore } from '../stores';
import type { Email } from '../../core/domain';

// Mock the stores
vi.mock('../stores', () => ({
  useEmailStore: vi.fn(),
  useUIStore: vi.fn(),
}));

// Helper to create test emails
const createEmail = (id: number, overrides: Partial<Email> = {}): Email => ({
  id,
  accountId: 1,
  folderId: 1,
  uid: id,
  messageId: `msg-${id}`,
  subject: `Test Email ${id}`,
  from: { address: `sender${id}@test.com`, name: `Sender ${id}` },
  to: [`recipient${id}@test.com`],
  date: new Date(),
  snippet: `Snippet for email ${id}`,
  sizeBytes: 1000,
  isRead: false,
  isStarred: false,
  hasAttachments: false,
  bodyFetched: false,
  // Threading
  inReplyTo: null,
  references: null,
  threadId: null,
  // Awaiting reply
  awaitingReply: false,
  awaitingReplySince: null,
  // Unsubscribe
  listUnsubscribe: null,
  listUnsubscribePost: null,
  ...overrides,
});

describe('useEmailListKeyboard', () => {
  const mockSetFocusedId = vi.fn();
  const mockToggleSelect = vi.fn();
  const mockSelectRange = vi.fn();
  const mockSelectAll = vi.fn();
  const mockClearSelection = vi.fn();
  const mockSelectEmail = vi.fn();
  const mockToggleStar = vi.fn();
  const mockBulkArchive = vi.fn();
  const mockBulkTrash = vi.fn();
  const mockOpenCompose = vi.fn();

  const emails = [createEmail(1), createEmail(2), createEmail(3)];

  beforeEach(() => {
    vi.clearAllMocks();

    (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      focusedId: 1,
      selectedIds: new Set<number>(),
      setFocusedId: mockSetFocusedId,
      toggleSelect: mockToggleSelect,
      selectRange: mockSelectRange,
      selectAll: mockSelectAll,
      clearSelection: mockClearSelection,
      selectEmail: mockSelectEmail,
      toggleStar: mockToggleStar,
      bulkArchive: mockBulkArchive,
      bulkTrash: mockBulkTrash,
    });

    (useUIStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      openCompose: mockOpenCompose,
    });
  });

  const fireKey = (key: string, options: Partial<KeyboardEvent> = {}) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      ...options,
    });
    window.dispatchEvent(event);
  };

  describe('arrow navigation', () => {
    it('moves focus down with ArrowDown', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('ArrowDown');
      });

      expect(mockSetFocusedId).toHaveBeenCalledWith(2);
    });

    it('moves focus up with ArrowUp', () => {
      (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useEmailStore(),
        focusedId: 2,
      });

      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('ArrowUp');
      });

      expect(mockSetFocusedId).toHaveBeenCalledWith(1);
    });

    it('does not go below last email', () => {
      (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useEmailStore(),
        focusedId: 3,
      });

      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('ArrowDown');
      });

      expect(mockSetFocusedId).toHaveBeenCalledWith(3);
    });

    it('does not go above first email', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('ArrowUp');
      });

      expect(mockSetFocusedId).toHaveBeenCalledWith(1);
    });

    it('extends selection with Shift+ArrowDown', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('ArrowDown', { shiftKey: true });
      });

      expect(mockSelectRange).toHaveBeenCalledWith(1, 2);
    });
  });

  describe('email actions', () => {
    it('opens email on Enter', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('Enter');
      });

      expect(mockSelectEmail).toHaveBeenCalledWith(1);
    });

    it('toggles star on S key', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('s');
      });

      expect(mockToggleStar).toHaveBeenCalledWith(1);
    });

    it('archives on E key', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('e');
      });

      expect(window.mailApi.emails.archive).toHaveBeenCalledWith(1);
    });

    it('trashes on Delete key', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('Delete');
      });

      expect(window.mailApi.emails.trash).toHaveBeenCalledWith(1);
    });

    it('trashes on Backspace key', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('Backspace');
      });

      expect(window.mailApi.emails.trash).toHaveBeenCalledWith(1);
    });
  });

  describe('compose actions', () => {
    it('opens reply on R key', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('r');
      });

      expect(mockOpenCompose).toHaveBeenCalledWith('reply', 1);
    });

    it('opens reply all on Shift+R', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('R', { shiftKey: true });
      });

      expect(mockOpenCompose).toHaveBeenCalledWith('replyAll', 1);
    });

    it('opens forward on F key', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('f');
      });

      expect(mockOpenCompose).toHaveBeenCalledWith('forward', 1);
    });
  });

  describe('selection', () => {
    it('toggles selection on Space', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey(' ');
      });

      expect(mockToggleSelect).toHaveBeenCalledWith(1);
    });

    it('selects all on Cmd+A', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('a', { metaKey: true });
      });

      expect(mockSelectAll).toHaveBeenCalled();
    });

    it('selects all on Ctrl+A', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('a', { ctrlKey: true });
      });

      expect(mockSelectAll).toHaveBeenCalled();
    });

    it('clears selection on Escape', () => {
      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('Escape');
      });

      expect(mockClearSelection).toHaveBeenCalled();
    });
  });

  describe('bulk actions', () => {
    it('bulk trashes when emails are selected', () => {
      (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useEmailStore(),
        selectedIds: new Set([1, 2]),
      });

      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('Delete');
      });

      expect(mockBulkTrash).toHaveBeenCalled();
      expect(window.mailApi.emails.trash).not.toHaveBeenCalled();
    });

    it('bulk archives when emails are selected', () => {
      (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useEmailStore(),
        selectedIds: new Set([1, 2]),
      });

      renderHook(() => useEmailListKeyboard(emails));

      act(() => {
        fireKey('e');
      });

      expect(mockBulkArchive).toHaveBeenCalled();
      expect(window.mailApi.emails.archive).not.toHaveBeenCalled();
    });
  });

  describe('input protection', () => {
    it('ignores keys when focused on input', () => {
      renderHook(() => useEmailListKeyboard(emails));

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
        });
        Object.defineProperty(event, 'target', { value: input });
        window.dispatchEvent(event);
      });

      expect(mockSetFocusedId).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });

  describe('auto-focus', () => {
    it('focuses first email on mount when none focused', () => {
      (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        ...useEmailStore(),
        focusedId: null,
      });

      renderHook(() => useEmailListKeyboard(emails));

      expect(mockSetFocusedId).toHaveBeenCalledWith(1);
    });

    it('does not change focus if already focused', () => {
      renderHook(() => useEmailListKeyboard(emails));

      // Only called once if auto-focus doesn't trigger
      expect(mockSetFocusedId).not.toHaveBeenCalled();
    });
  });
});
