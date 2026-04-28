/**
 * Tests for useEmailListKeyboard hook.
 *
 * UI store + RTK Query mutation hooks are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEmailListKeyboard } from './useEmailListKeyboard';
import type { Email } from '../../core/domain';

const mockSetFocusedId = vi.fn();
const mockToggleSelect = vi.fn();
const mockSelectRange = vi.fn();
const mockSelectAll = vi.fn();
const mockClearSelection = vi.fn();
const mockSelectEmail = vi.fn();
const mockSetStarred = vi.fn().mockResolvedValue({ data: undefined });
const mockBulkArchive = vi.fn().mockResolvedValue({ data: undefined });
const mockBulkTrash = vi.fn().mockResolvedValue({ data: undefined });
const mockOpenCompose = vi.fn();

let mockUiState: {
  focusedId: number | null;
  selectedIds: Set<number>;
} = {
  focusedId: 1,
  selectedIds: new Set(),
};

vi.mock('../stores', () => ({
  useEmailUiStore: (selector: (s: unknown) => unknown) =>
    selector({
      focusedId: mockUiState.focusedId,
      selectedIds: mockUiState.selectedIds,
      setFocusedId: mockSetFocusedId,
      toggleSelect: mockToggleSelect,
      selectRange: mockSelectRange,
      selectAll: mockSelectAll,
      clearSelection: mockClearSelection,
      selectEmail: mockSelectEmail,
    }),
  useUIStore: (selector?: (s: unknown) => unknown) => {
    const state = { openCompose: mockOpenCompose };
    return selector ? selector(state) : state;
  },
  useBulkArchiveMutation: () => [mockBulkArchive, { isLoading: false }],
  useBulkTrashMutation: () => [mockBulkTrash, { isLoading: false }],
  useSetStarredMutation: () => [mockSetStarred, { isLoading: false }],
}));

vi.mock('./useCurrentListArg', () => ({
  useCurrentListArg: () => ({ accountId: 1, folderPath: 'INBOX' }),
}));

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
  inReplyTo: null,
  references: null,
  threadId: null,
  awaitingReply: false,
  awaitingReplySince: null,
  listUnsubscribe: null,
  listUnsubscribePost: null,
  ...overrides,
});

describe('useEmailListKeyboard', () => {
  const emails = [createEmail(1), createEmail(2), createEmail(3)];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUiState = { focusedId: 1, selectedIds: new Set() };
  });

  const fireKey = (key: string, options: Partial<KeyboardEvent> = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
  };

  describe('arrow navigation', () => {
    it('moves focus down with ArrowDown', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('ArrowDown'));
      expect(mockSetFocusedId).toHaveBeenCalledWith(2);
    });

    it('moves focus up with ArrowUp', () => {
      mockUiState.focusedId = 2;
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('ArrowUp'));
      expect(mockSetFocusedId).toHaveBeenCalledWith(1);
    });

    it('does not go below last email', () => {
      mockUiState.focusedId = 3;
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('ArrowDown'));
      expect(mockSetFocusedId).toHaveBeenCalledWith(3);
    });

    it('does not go above first email', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('ArrowUp'));
      expect(mockSetFocusedId).toHaveBeenCalledWith(1);
    });

    it('extends selection with Shift+ArrowDown', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('ArrowDown', { shiftKey: true }));
      expect(mockSelectRange).toHaveBeenCalledWith([1, 2, 3], 1, 2);
    });
  });

  describe('email actions', () => {
    it('opens email on Enter', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('Enter'));
      expect(mockSelectEmail).toHaveBeenCalledWith(1);
    });

    it('toggles star via mutation on S key', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('s'));
      expect(mockSetStarred).toHaveBeenCalledWith({
        id: 1,
        isStarred: true,
        listArg: { accountId: 1, folderPath: 'INBOX' },
      });
    });

    it('archives single focused email via mailApi on E key', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('e'));
      expect(window.mailApi.emails.archive).toHaveBeenCalledWith(1);
    });

    it('trashes single focused email via mailApi on Delete key', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('Delete'));
      expect(window.mailApi.emails.trash).toHaveBeenCalledWith(1);
    });

    it('trashes single focused email via mailApi on Backspace key', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('Backspace'));
      expect(window.mailApi.emails.trash).toHaveBeenCalledWith(1);
    });
  });

  describe('compose actions', () => {
    it('opens reply on R key', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('r'));
      expect(mockOpenCompose).toHaveBeenCalledWith('reply', 1);
    });

    it('opens reply all on Shift+R', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('R', { shiftKey: true }));
      expect(mockOpenCompose).toHaveBeenCalledWith('replyAll', 1);
    });

    it('opens forward on F key', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('f'));
      expect(mockOpenCompose).toHaveBeenCalledWith('forward', 1);
    });
  });

  describe('selection', () => {
    it('toggles selection on Space', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey(' '));
      expect(mockToggleSelect).toHaveBeenCalledWith(1);
    });

    it('selects all on Cmd+A', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('a', { metaKey: true }));
      expect(mockSelectAll).toHaveBeenCalledWith([1, 2, 3]);
    });

    it('clears selection on Escape', () => {
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('Escape'));
      expect(mockClearSelection).toHaveBeenCalled();
    });
  });

  describe('bulk actions', () => {
    it('bulk trashes when emails are selected', () => {
      mockUiState.selectedIds = new Set([1, 2]);
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('Delete'));
      expect(mockBulkTrash).toHaveBeenCalledWith({
        ids: [1, 2],
        listArg: { accountId: 1, folderPath: 'INBOX' },
      });
      expect(window.mailApi.emails.trash).not.toHaveBeenCalled();
    });

    it('bulk archives when emails are selected', () => {
      mockUiState.selectedIds = new Set([1, 2]);
      renderHook(() => useEmailListKeyboard(emails));
      act(() => fireKey('e'));
      expect(mockBulkArchive).toHaveBeenCalledWith({
        ids: [1, 2],
        listArg: { accountId: 1, folderPath: 'INBOX' },
      });
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
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
        Object.defineProperty(event, 'target', { value: input });
        window.dispatchEvent(event);
      });
      expect(mockSetFocusedId).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });
  });

  describe('auto-focus', () => {
    it('focuses first email on mount when none focused', () => {
      mockUiState.focusedId = null;
      renderHook(() => useEmailListKeyboard(emails));
      expect(mockSetFocusedId).toHaveBeenCalledWith(1);
    });

    it('does not change focus if already focused', () => {
      renderHook(() => useEmailListKeyboard(emails));
      expect(mockSetFocusedId).not.toHaveBeenCalled();
    });
  });
});
