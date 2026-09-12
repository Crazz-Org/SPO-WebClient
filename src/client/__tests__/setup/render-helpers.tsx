/**
 * Test render helpers for component smoke tests.
 *
 * Provides:
 * - mockClientCallbacks: no-op stub for every ClientCallbacks method
 * - renderWithProviders(): wraps component in ClientContext.Provider
 * - resetStores(): clears all Zustand stores between tests
 */

import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ClientContext } from '../../context/ClientContext';
import type { ClientCallbacks } from '../../bridge/client-bridge';
import { useBuildingStore } from '../../store/building-store';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';

/** No-op stub for every ClientCallbacks method. */
export function createMockClientCallbacks(): ClientCallbacks {
  return new Proxy({} as ClientCallbacks, {
    get: (_target, prop) => {
      if (typeof prop === 'string') {
        return (..._args: unknown[]) => { /* no-op */ };
      }
      return undefined;
    },
  });
}

/** Default mock callbacks instance for tests. */
export const mockClientCallbacks = createMockClientCallbacks();

/** Create mock callbacks with specific methods replaced by spies/stubs. */
export function createSpiedCallbacks(overrides: Record<string, (...args: unknown[]) => unknown>): ClientCallbacks {
  return new Proxy({} as ClientCallbacks, {
    get: (_target, prop) => {
      if (typeof prop === 'string' && prop in overrides) {
        return overrides[prop];
      }
      if (typeof prop === 'string') {
        return (..._args: unknown[]) => { /* no-op */ };
      }
      return undefined;
    },
  });
}

/** Reset Zustand stores to initial state. */
export function resetStores(): void {
  useBuildingStore.getState().clearFocus();
  useBuildingStore.getState().forgetSection();
  useUiStore.getState().closeModal();
  useUiStore.getState().closeRightPanel();
  useGameStore.setState({ isPublicOfficeRole: false });
}

/** Render a component wrapped in ClientContext.Provider. */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { clientCallbacks?: ClientCallbacks },
) {
  const callbacks = options?.clientCallbacks ?? mockClientCallbacks;
  const { clientCallbacks: _, ...renderOptions } = options ?? {};

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ClientContext.Provider value={callbacks}>
        {children}
      </ClientContext.Provider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
