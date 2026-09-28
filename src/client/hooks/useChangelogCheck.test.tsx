/**
 * Tests for the useChangelogCheck hook.
 *
 * A returning player whose stored version differs gets the changelog modal; a first
 * visit records the version silently with no popup (maintainer decision 2026-09-27,
 * issue 1050); a matching version, or unavailable storage, keeps it closed.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ClientContext } from '../context/ClientContext';
import { createMockClientCallbacks } from '../__tests__/setup/render-helpers';
import { useUiStore } from '../store/ui-store';
import { APP_VERSION } from '../version';
import { useChangelogCheck } from './useChangelogCheck';

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
  it('does not open on a first visit, and records the version', () => {
    renderHook(() => useChangelogCheck(), { wrapper });

    act(() => { jest.advanceTimersByTime(1000); });
    expect(useUiStore.getState().modal).toBeNull();
    expect(localStorage.getItem('spo-last-seen-version')).toBe(APP_VERSION);
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

  it('does not open modal when version matches localStorage', () => {
    localStorage.setItem('spo-last-seen-version', APP_VERSION);
    renderHook(() => useChangelogCheck(), { wrapper });

    act(() => { jest.advanceTimersByTime(1000); });
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('opens modal when stored version differs from current', () => {
    localStorage.setItem('spo-last-seen-version', '0.0.1');
    renderHook(() => useChangelogCheck(), { wrapper });

    act(() => { jest.advanceTimersByTime(500); });
    expect(useUiStore.getState().modal).toBe('changelog');
  });
});
