/**
 * SettingsDialog — the retired wire-history report (#1053): no Debug section, no button,
 * and nothing in the dialog posts the wire history to the gateway.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { SettingsDialog } from './SettingsDialog';

const SKIPPED = new Set(['Logout', 'Close', 'Report a problem']);

describe('SettingsDialog retired wire-history report', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock<(input: unknown, init?: unknown) => Promise<unknown>>;

  beforeEach(() => {
    resetStores();
    useUiStore.getState().openModal('settings');
    (window as unknown as Record<string, unknown>).__spoDebug = {
      history: [{ dir: 'SEND', type: 'X', ts: 1 }],
    };
    fetchMock = jest.fn(async () => ({ json: async () => ({ ok: true }) }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (window as unknown as Record<string, unknown>).__spoDebug;
  });

  it('offers no send-debug-report button', () => {
    renderWithProviders(<SettingsDialog />);
    expect(screen.queryByRole('button', { name: /send debug report/i })).toBeNull();
  });

  it('has no Debug section heading', () => {
    renderWithProviders(<SettingsDialog />);
    expect(screen.queryByRole('heading', { name: 'Debug' })).toBeNull();
  });

  it('never posts to the debug-log endpoint while the dialog is used', async () => {
    renderWithProviders(<SettingsDialog />);
    for (const btn of screen.getAllByRole('button')) {
      const name = btn.getAttribute('aria-label') ?? btn.textContent ?? '';
      if (SKIPPED.has(name.trim())) continue;
      fireEvent.click(btn);
    }
    await Promise.resolve();
    expect(fetchMock.mock.calls.some(([u]) => /\/api\/debug-log/.test(String(u)))).toBe(false);
  });
});
