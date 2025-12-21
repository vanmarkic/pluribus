/**
 * Tests for BulkActionBar component
 *
 * Tests bulk action bar that appears when emails are selected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BulkActionBar } from './BulkActionBar';
import { useEmailStore } from '../stores';

// Mock the store
vi.mock('../stores', () => ({
  useEmailStore: vi.fn(),
}));

describe('BulkActionBar', () => {
  const mockClearSelection = vi.fn();
  const mockBulkArchive = vi.fn().mockResolvedValue(undefined);
  const mockBulkTrash = vi.fn().mockResolvedValue(undefined);
  const mockBulkMarkRead = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();

    (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedIds: new Set([1, 2, 3]),
      clearSelection: mockClearSelection,
      bulkArchive: mockBulkArchive,
      bulkTrash: mockBulkTrash,
      bulkMarkRead: mockBulkMarkRead,
    });
  });

  describe('visibility', () => {
    it('renders when emails are selected', () => {
      render(<BulkActionBar />);

      expect(screen.getByText('3 selected')).toBeInTheDocument();
    });

    it('does not render when no emails selected', () => {
      (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        selectedIds: new Set(),
        clearSelection: mockClearSelection,
        bulkArchive: mockBulkArchive,
        bulkTrash: mockBulkTrash,
        bulkMarkRead: mockBulkMarkRead,
      });

      const { container } = render(<BulkActionBar />);

      expect(container.firstChild).toBeNull();
    });

    it('shows correct count for 1 selected', () => {
      (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        selectedIds: new Set([1]),
        clearSelection: mockClearSelection,
        bulkArchive: mockBulkArchive,
        bulkTrash: mockBulkTrash,
        bulkMarkRead: mockBulkMarkRead,
      });

      render(<BulkActionBar />);

      expect(screen.getByText('1 selected')).toBeInTheDocument();
    });

    it('shows correct count for many selected', () => {
      (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        selectedIds: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        clearSelection: mockClearSelection,
        bulkArchive: mockBulkArchive,
        bulkTrash: mockBulkTrash,
        bulkMarkRead: mockBulkMarkRead,
      });

      render(<BulkActionBar />);

      expect(screen.getByText('10 selected')).toBeInTheDocument();
    });
  });

  describe('clear selection', () => {
    it('calls clearSelection when X button clicked', () => {
      render(<BulkActionBar />);

      const clearButton = screen.getByTitle('Clear selection (Esc)');
      fireEvent.click(clearButton);

      expect(mockClearSelection).toHaveBeenCalled();
    });
  });

  describe('bulk actions', () => {
    it('calls bulkMarkRead(true) when Mark read clicked', async () => {
      render(<BulkActionBar />);

      fireEvent.click(screen.getByText('Mark read'));

      await waitFor(() => {
        expect(mockBulkMarkRead).toHaveBeenCalledWith(true);
      });
    });

    it('calls bulkArchive when Archive clicked', async () => {
      render(<BulkActionBar />);

      fireEvent.click(screen.getByText('Archive'));

      await waitFor(() => {
        expect(mockBulkArchive).toHaveBeenCalled();
      });
    });

    it('calls bulkTrash when Delete clicked', async () => {
      render(<BulkActionBar />);

      fireEvent.click(screen.getByText('Delete'));

      await waitFor(() => {
        expect(mockBulkTrash).toHaveBeenCalled();
      });
    });
  });

  describe('action buttons', () => {
    it('renders all action buttons', () => {
      render(<BulkActionBar />);

      expect(screen.getByText('Mark read')).toBeInTheDocument();
      expect(screen.getByText('Archive')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('has proper button styling', () => {
      render(<BulkActionBar />);

      const deleteButton = screen.getByText('Delete').closest('button');
      expect(deleteButton).toHaveStyle({ background: 'var(--color-danger)' });
    });
  });
});
