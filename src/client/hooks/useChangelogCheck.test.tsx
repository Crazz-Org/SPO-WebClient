/**
 * Tests for the useChangelogCheck hook.
 *
 * The modal opens only when a player note (mocked here) has not been seen. A first visit
 * records every id silently with no popup (maintainer decision 2026-09-27, issue 1050); every
 * id seen, or unavailable storage, keeps it closed.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ClientContext } from '../context/ClientContext';
import { createMockClientCallbacks } from '../__tests__/setup/render-helpers';
import { useUiStore } from '../store/ui-store';
import { useChangelogCheck } from './useChangelogCheck';

jest.mock('../player-notes.json', () => [
  { id: 7, date: '2026-10-01', type: 'fixed', text: 'A fix.' },
  { id: 8, date: '2026-10-02', type: 'added', text: 'An addition.' },
  { id: 9, date: '2026-10-02', type: 'changed', text: 'A change.' },
]);

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

describe('useChangelogCheck', () => {
  it('does not open on a first visit, and records every note id', () => {
    renderHook(() => useChangelogCheck(), { wrapper });

    act(() => { jest.advanceTimersByTime(1000); });
    expect(useUiStore.getState().modal).toBeNull();
    const stored = JSON.parse(localStorage.getItem('spo-seen-notes') ?? 'null') as number[];
    expect(stored.slice().sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });

  it('does not open, and does not throw, when storage is unavailable', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(() => renderHook(() => useChangelogCheck(), { wrapper })).not.toThrow();
      act(() => { jest.advanceTimersByTime(1000); });
      expect(useUiStore.getState().modal).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('does not open when every note id is stored', () => {
    localStorage.setItem('spo-seen-notes', '[7,8,9]');
    renderHook(() => useChangelogCheck(), { wrapper });

    act(() => { jest.advanceTimersByTime(1000); });
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('opens after 500 ms when one note id is missing', () => {
    localStorage.setItem('spo-seen-notes', '[7,9]');
    renderHook(() => useChangelogCheck(), { wrapper });

    act(() => { jest.advanceTimersByTime(499); });
    expect(useUiStore.getState().modal).toBeNull();
    act(() => { jest.advanceTimersByTime(1); });
    expect(useUiStore.getState().modal).toBe('changelog');
  });
});
