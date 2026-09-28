/**
 * ErrorBoundary — Catches React render errors and shows a fallback UI.
 *
 * Prevents a single component crash from tearing down the entire React tree.
 */

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div style={{
          padding: '16px',
          color: '#f87171',
          fontSize: '0.8rem',
          fontFamily: 'var(--font-mono, monospace)',
        }}>
          Something went wrong.
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginLeft: '8px',
              background: 'none',
              border: '1px solid currentColor',
              color: 'inherit',
              padding: '2px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: 'inherit',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
