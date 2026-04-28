/**
 * Tests for EmailQuickActions component.
 *
 * Mutations are mocked at the RTK Query hook level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmailQuickActions } from './EmailQuickActions';

const mockArchive = vi.fn().mockResolvedValue({ data: undefined });
const mockTrash = vi.fn().mockResolvedValue({ data: undefined });
const mockMarkRead = vi.fn().mockResolvedValue({ data: undefined });

vi.mock('../stores', () => ({
  useArchiveEmailMutation: () => [mockArchive, { isLoading: false }],
  useTrashEmailMutation: () => [mockTrash, { isLoading: false }],
  useMarkReadMutation: () => [mockMarkRead, { isLoading: false }],
}));

vi.mock('../hooks/useCurrentListArg', () => ({
  useCurrentListArg: () => ({ accountId: 1, folderPath: 'INBOX' }),
}));

describe('EmailQuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('archive action', () => {
    it('calls archive mutation with id and listArg on click', async () => {
      render(<EmailQuickActions emailId={42} isRead={false} />);
      fireEvent.click(screen.getByLabelText('Archive'));
      await waitFor(() => {
        expect(mockArchive).toHaveBeenCalledWith({
          id: 42,
          listArg: { accountId: 1, folderPath: 'INBOX' },
        });
      });
    });

    it('calls onAction callback after archive', async () => {
      const onAction = vi.fn();
      render(<EmailQuickActions emailId={1} isRead={false} onAction={onAction} />);
      fireEvent.click(screen.getByLabelText('Archive'));
      await waitFor(() => expect(onAction).toHaveBeenCalled());
    });

    it('stops event propagation', () => {
      const parentClick = vi.fn();
      render(
        <div onClick={parentClick}>
          <EmailQuickActions emailId={1} isRead={false} />
        </div>,
      );
      fireEvent.click(screen.getByLabelText('Archive'));
      expect(parentClick).not.toHaveBeenCalled();
    });
  });

  describe('delete action', () => {
    it('calls trash mutation with id and listArg', async () => {
      render(<EmailQuickActions emailId={99} isRead={false} />);
      fireEvent.click(screen.getByLabelText('Delete'));
      await waitFor(() => {
        expect(mockTrash).toHaveBeenCalledWith({
          id: 99,
          listArg: { accountId: 1, folderPath: 'INBOX' },
        });
      });
    });
  });

  describe('mark read/unread action', () => {
    it('marks as read when email is unread', async () => {
      render(<EmailQuickActions emailId={5} isRead={false} />);
      fireEvent.click(screen.getByLabelText('Mark read'));
      await waitFor(() => {
        expect(mockMarkRead).toHaveBeenCalledWith({
          id: 5,
          isRead: true,
          listArg: { accountId: 1, folderPath: 'INBOX' },
        });
      });
    });

    it('marks as unread when email is read', async () => {
      render(<EmailQuickActions emailId={5} isRead={true} />);
      fireEvent.click(screen.getByLabelText('Mark unread'));
      await waitFor(() => {
        expect(mockMarkRead).toHaveBeenCalledWith({
          id: 5,
          isRead: false,
          listArg: { accountId: 1, folderPath: 'INBOX' },
        });
      });
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
