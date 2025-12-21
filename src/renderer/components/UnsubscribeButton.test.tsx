// src/renderer/components/UnsubscribeButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnsubscribeButton } from './UnsubscribeButton';

describe('UnsubscribeButton', () => {
  it('renders nothing when no unsubscribe header', () => {
    const { container } = render(
      <UnsubscribeButton listUnsubscribe={null} onUnsubscribe={() => {}} />
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders button when unsubscribe header present', () => {
    render(
      <UnsubscribeButton
        listUnsubscribe="<mailto:unsub@test.com>"
        onUnsubscribe={() => {}}
      />
    );

    expect(screen.getByLabelText(/unsubscribe/i)).toBeInTheDocument();
  });

  it('shows confirmation dialog on click', () => {
    render(
      <UnsubscribeButton
        listUnsubscribe="<mailto:unsub@test.com>"
        senderName="Newsletter"
        onUnsubscribe={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText(/unsubscribe/i));

    expect(screen.getByText(/unsubscribe from newsletter/i)).toBeInTheDocument();
  });

  it('calls onUnsubscribe when confirmed', () => {
    const onUnsubscribe = vi.fn();
    render(
      <UnsubscribeButton
        listUnsubscribe="<mailto:unsub@test.com>"
        onUnsubscribe={onUnsubscribe}
      />
    );

    fireEvent.click(screen.getByLabelText(/unsubscribe/i));
    fireEvent.click(screen.getByText(/^unsubscribe$/i));

    expect(onUnsubscribe).toHaveBeenCalled();
  });

  it('closes dialog on cancel', () => {
    render(
      <UnsubscribeButton
        listUnsubscribe="<mailto:unsub@test.com>"
        onUnsubscribe={() => {}}
      />
    );

    fireEvent.click(screen.getByLabelText(/unsubscribe/i));
    fireEvent.click(screen.getByText(/cancel/i));

    expect(screen.queryByText(/unsubscribe from/i)).not.toBeInTheDocument();
  });
});
