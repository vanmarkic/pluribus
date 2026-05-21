/**
 * Error Boundary
 *
 * Catches render-time exceptions in its subtree so a single broken view
 * doesn't blank the whole window. Errors are logged to the console (the
 * renderer has no remote error reporting) and shown inline with a
 * recovery affordance.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error boundary caught:', error, info.componentStack);
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
          style={{ background: 'var(--color-bg-secondary)' }}
        >
          <div className="text-lg font-medium">Something went wrong</div>
          <div className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
            {error.message || 'An unexpected error occurred.'}
          </div>
          <button className="btn btn-secondary" onClick={this.handleReset}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
