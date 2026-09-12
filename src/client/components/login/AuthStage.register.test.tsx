/**
 * "Create an account" only appears when the gateway configures a registration URL.
 *
 * The gateway announces it through `window.__SPO_REGISTER_URL__` (`/spo-runtime-config.js`),
 * and AuthStage reads it per render — so each case sets the flag on `window` before mounting.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { AuthStage } from './AuthStage';

function setRegisterUrl(value: string | undefined): void {
  const w = window as unknown as Record<string, unknown>;
  if (value === undefined) {
    delete w.__SPO_REGISTER_URL__;
  } else {
    w.__SPO_REGISTER_URL__ = value;
  }
}

const props = { onConnect: () => {}, isLoading: false, status: 'idle' };

describe('AuthStage "Create an account" action', () => {
  afterEach(() => {
    setRegisterUrl(undefined);
  });

  it('offers "Create an account" when a registration URL is configured, in a new tab', () => {
    setRegisterUrl('https://example.org/signup');
    renderWithProviders(<AuthStage {...props} />);

    const link = screen.getByRole('link', { name: 'Create an account' }) as HTMLAnchorElement;
    expect(link.href).toBe('https://example.org/signup');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  it('renders no action when no URL is configured', () => {
    setRegisterUrl(undefined);
    renderWithProviders(<AuthStage {...props} />);

    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
    expect(screen.getByPlaceholderText('Username')).not.toBeNull();
    expect(screen.getByPlaceholderText('Password')).not.toBeNull();
    expect(screen.getByText('Enter the World')).not.toBeNull();
  });

  it('renders no action for an empty string', () => {
    setRegisterUrl('');
    renderWithProviders(<AuthStage {...props} />);

    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
  });

  it('ignores a value that is not an http(s) URL', () => {
    setRegisterUrl('javascript:alert(1)');
    renderWithProviders(<AuthStage {...props} />);

    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull();
  });
});
