/**
 * Tests for EmailQuickActions component
 *
 * Tests hover action buttons: archive, trash, mark read/unread
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmailQuickActions } from './EmailQuickActions';
import { useEmailStore } from '../stores';

// Mock the store
vi.mock('../stores', () => ({
  useEmailStore: vi.fn(),
}));

describe('EmailQuickActions', () => {
  const mockArchive = vi.fn().mockResolvedValue(undefined);
  const mockDeleteEmail = vi.fn().mockResolvedValue(undefined);
  const mockMarkRead = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();

    (useEmailStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      archive: mockArchive,
      deleteEmail: mockDeleteEmail,
      markRead: mockMarkRead,
    });
  });

  it('renders three action buttons', () => {
    render(<EmailQuickActions emailId={1} isRead={false} />);

    expect(screen.getByLabelText('Archive')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete')).toBeInTheDocument();
    expect(screen.getByLabelText('Mark read')).toBeInTheDocument();
  });

  it('shows "Mark unread" when email is read', () => {
    render(<EmailQuickActions emailId={1} isRead={true} />);

    expect(screen.getByLabelText('Mark unread')).toBeInTheDocument();
  });

  it('shows "Mark read" when email is unread', () => {
    render(<EmailQuickActions emailId={1} isRead={false} />);

    expect(screen.getByLabelText('Mark read')).toBeInTheDocument();
  });

  describe('archive action', () => {
    it('calls archive with email id on click', async () => {
      render(<EmailQuickActions emailId={42} isRead={false} />);

      fireEvent.click(screen.getByLabelText('Archive'));

      await waitFor(() => {
        expect(mockArchive).toHaveBeenCalledWith(42);
      });
    });

    it('calls onAction callback after archive', async () => {
      const onAction = vi.fn();
      render(<EmailQuickActions emailId={1} isRead={false} onAction={onAction} />);

      fireEvent.click(screen.getByLabelText('Archive'));

      await waitFor(() => {
        expect(onAction).toHaveBeenCalled();
      });
    });

    it('stops event propagation', () => {
      const parentClick = vi.fn();
      render(
        <div onClick={parentClick}>
          <EmailQuickActions emailId={1} isRead={false} />
        </div>
      );

      fireEvent.click(screen.getByLabelText('Archive'));

      expect(parentClick).not.toHaveBeenCalled();
    });
  });

  describe('delete action', () => {
    it('calls deleteEmail with email id on click', async () => {
      render(<EmailQuickActions emailId={99} isRead={false} />);

      fireEvent.click(screen.getByLabelText('Delete'));

      await waitFor(() => {
        expect(mockDeleteEmail).toHaveBeenCalledWith(99);
      });
    });

    it('calls onAction callback after delete', async () => {
      const onAction = vi.fn();
      render(<EmailQuickActions emailId={1} isRead={false} onAction={onAction} />);

      fireEvent.click(screen.getByLabelText('Delete'));

      await waitFor(() => {
        expect(onAction).toHaveBeenCalled();
      });
    });
  });

  describe('mark read/unread action', () => {
    it('marks as read when email is unread', async () => {
      render(<EmailQuickActions emailId={5} isRead={false} />);

      fireEvent.click(screen.getByLabelText('Mark read'));

      await waitFor(() => {
        expect(mockMarkRead).toHaveBeenCalledWith(5, true);
      });
    });

    it('marks as unread when email is read', async () => {
      render(<EmailQuickActions emailId={5} isRead={true} />);

      fireEvent.click(screen.getByLabelText('Mark unread'));

      await waitFor(() => {
        expect(mockMarkRead).toHaveBeenCalledWith(5, false);
      });
    });

    it('calls onAction callback after toggle', async () => {
      const onAction = vi.fn();
      render(<EmailQuickActions emailId={1} isRead={false} onAction={onAction} />);

      fireEvent.click(screen.getByLabelText('Mark read'));

      await waitFor(() => {
        expect(onAction).toHaveBeenCalled();
      });
    });
  });

  describe('container click handling', () => {
    it('stops propagation on container click', () => {
      const parentClick = vi.fn();
      render(
        <div onClick={parentClick}>
          <EmailQuickActions emailId={1} isRead={false} />
        </div>
      );

      // Click the container div (not a button)
      const container = screen.getByLabelText('Archive').parentElement!;
      fireEvent.click(container);

      expect(parentClick).not.toHaveBeenCalled();
    });
  });

  describe('button titles', () => {
    it('shows keyboard shortcut hints', () => {
      render(<EmailQuickActions emailId={1} isRead={false} />);

      expect(screen.getByTitle('Archive (E)')).toBeInTheDocument();
      expect(screen.getByTitle('Delete (Del)')).toBeInTheDocument();
    });
  });
});
