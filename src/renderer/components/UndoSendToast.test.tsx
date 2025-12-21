/**
 * Tests for UndoSendToast component
 *
 * Tests the "Undo Send" toast with countdown timer functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UndoSendToast } from './UndoSendToast';

describe('UndoSendToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders message sent text', () => {
    render(<UndoSendToast expiresAt={new Date(Date.now() + 10000)} onUndo={() => {}} />);

    expect(screen.getByText(/message sent/i)).toBeInTheDocument();
  });

  it('shows countdown timer', () => {
    render(<UndoSendToast expiresAt={new Date(Date.now() + 10000)} onUndo={() => {}} />);

    expect(screen.getByText(/10/)).toBeInTheDocument();
  });

  it('updates countdown every second', () => {
    render(<UndoSendToast expiresAt={new Date(Date.now() + 10000)} onUndo={() => {}} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText(/9/)).toBeInTheDocument();
  });

  it('calls onUndo when button clicked', () => {
    const onUndo = vi.fn();
    render(<UndoSendToast expiresAt={new Date(Date.now() + 10000)} onUndo={onUndo} />);

    fireEvent.click(screen.getByText(/undo/i));

    expect(onUndo).toHaveBeenCalled();
  });

  it('calls onExpire when countdown reaches 0', () => {
    const onExpire = vi.fn();
    render(<UndoSendToast expiresAt={new Date(Date.now() + 1000)} onUndo={() => {}} onExpire={onExpire} />);

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(onExpire).toHaveBeenCalled();
  });
});
