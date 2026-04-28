/**
 * Tests for BulkActionBar component.
 *
 * Server data lives in RTK Query; these tests mock the mutation hooks and
 * the UI store to assert that bulk actions dispatch the right calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BulkActionBar } from './BulkActionBar';

const mockBulkArchive = vi.fn().mockResolvedValue({ data: undefined });
const mockBulkTrash = vi.fn().mockResolvedValue({ data: undefined });
const mockBulkMarkRead = vi.fn().mockResolvedValue({ data: undefined });
const mockClearSelection = vi.fn();
let mockSelectedIds = new Set<number>([1, 2, 3]);

vi.mock('../stores', () => ({
  useEmailUiStore: (selector: (s: unknown) => unknown) =>
    selector({
      selectedIds: mockSelectedIds,
      clearSelection: mockClearSelection,
    }),
  useBulkArchiveMutation: () => [mockBulkArchive, { isLoading: false }],
  useBulkTrashMutation: () => [mockBulkTrash, { isLoading: false }],
  useBulkMarkReadMutation: () => [mockBulkMarkRead, { isLoading: false }],
}));

vi.mock('../hooks/useCurrentListArg', () => ({
  useCurrentListArg: () => ({ accountId: 1, folderPath: 'INBOX' }),
}));

describe('BulkActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedIds = new Set<number>([1, 2, 3]);
  });

  describe('visibility', () => {
    it('renders when emails are selected', () => {
      render(<BulkActionBar />);
      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    it('does not render when no emails selected', () => {
      mockSelectedIds = new Set();
      const { container } = render(<BulkActionBar />);
      expect(container.firstChild).toBeNull();
    });

    it('shows correct count for many selected', () => {
      mockSelectedIds = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      render(<BulkActionBar />);
      expect(screen.getByText('10 selected')).toBeInTheDocument();
    });
  });

  describe('clear selection', () => {
    it('calls clearSelection when X button clicked', () => {
      render(<BulkActionBar />);
      fireEvent.click(screen.getByTitle('Clear selection (Esc)'));
      expect(mockClearSelection).toHaveBeenCalled();
    });
  });

  describe('bulk actions', () => {
    it('calls bulkMarkRead with isRead=true and the active listArg', async () => {
      render(<BulkActionBar />);
      fireEvent.click(screen.getByText('Mark read'));
      await waitFor(() => {
        expect(mockBulkMarkRead).toHaveBeenCalledWith({
          ids: [1, 2, 3],
          isRead: true,
          listArg: { accountId: 1, folderPath: 'INBOX' },
        });
      });
    });

    it('calls bulkArchive with the active listArg', async () => {
      render(<BulkActionBar />);
      fireEvent.click(screen.getByText('Archive'));
      await waitFor(() => {
        expect(mockBulkArchive).toHaveBeenCalledWith({
          ids: [1, 2, 3],
          listArg: { accountId: 1, folderPath: 'INBOX' },
        });
      });
    });

    it('calls bulkTrash with the active listArg', async () => {
      render(<BulkActionBar />);
      fireEvent.click(screen.getByText('Delete'));
      await waitFor(() => {
        expect(mockBulkTrash).toHaveBeenCalledWith({
          ids: [1, 2, 3],
          listArg: { accountId: 1, folderPath: 'INBOX' },
        });
      });
    });

    it('clears selection after a bulk action', async () => {
      render(<BulkActionBar />);
      fireEvent.click(screen.getByText('Archive'));
      await waitFor(() => expect(mockClearSelection).toHaveBeenCalled());
    });
  });

  describe('action buttons', () => {
    it('renders all action buttons', () => {
      render(<BulkActionBar />);
      expect(screen.getByText('Mark read')).toBeInTheDocument();
      expect(screen.getByText('Archive')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });
});
