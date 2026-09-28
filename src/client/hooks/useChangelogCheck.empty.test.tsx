/**
 * useChangelogCheck with no player notes: the modal never opens.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ClientContext } from '../context/ClientContext';
import { createMockClientCallbacks } from '../__tests__/setup/render-helpers';
import { useUiStore } from '../store/ui-store';
import { useChangelogCheck } from './useChangelogCheck';

jest.mock('../player-notes.json', () => []);

const mockCallbacks = createMockClientCallbacks();

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ClientContext.Provider value={mockCallbacks}>
      {children}
    </ClientContext.Provider>
  );
}

beforeEach(() => {
  useUiStore.getState().closeModal();
  localStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useChangelogCheck with no notes', () => {
  it('never opens with a stored key', () => {
    localStorage.setItem('spo-seen-notes', '[1]');
    renderHook(() => useChangelogCheck(), { wrapper });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('never opens with empty storage', () => {
    renderHook(() => useChangelogCheck(), { wrapper });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(useUiStore.getState().modal).toBeNull();
  });
});
