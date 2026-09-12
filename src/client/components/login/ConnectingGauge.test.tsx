/**
 * ConnectingGauge — deadline progress against a known TIMEOUT_CONFIG entry.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { ConnectingGauge } from './ConnectingGauge';
import { TimeoutCategory, TIMEOUT_CONFIG } from '@/shared/timeout-categories';

describe('ConnectingGauge', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports 0%, 50% and 100% against the DIRECTORY deadline, then clamps', () => {
    const deadline = TIMEOUT_CONFIG[TimeoutCategory.DIRECTORY].rdoMs;
    renderWithProviders(
      <ConnectingGauge label="Querying region..." category={TimeoutCategory.DIRECTORY} />,
    );

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');

    act(() => {
      jest.advanceTimersByTime(deadline / 2);
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');

    act(() => {
      jest.advanceTimersByTime(deadline / 2);
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');

    act(() => {
      jest.advanceTimersByTime(deadline);
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.closest('[data-deadline-reached]')?.getAttribute('data-deadline-reached')).toBe('true');
  });

  it('follows TIMEOUT_CONFIG for a different category', () => {
    const deadline = TIMEOUT_CONFIG[TimeoutCategory.NORMAL].rdoMs;
    renderWithProviders(
      <ConnectingGauge label="Connecting to world..." category={TimeoutCategory.NORMAL} />,
    );

    const bar = screen.getByRole('progressbar');
    act(() => {
      jest.advanceTimersByTime(deadline / 2);
    });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });

  it('shows the label', () => {
    renderWithProviders(
      <ConnectingGauge label="Querying region..." category={TimeoutCategory.DIRECTORY} />,
    );
    expect(screen.getByText('Querying region...')).toBeTruthy();
  });

  it('clears its interval on unmount', () => {
    const before = jest.getTimerCount();
    const { unmount } = renderWithProviders(
      <ConnectingGauge label="Querying region..." category={TimeoutCategory.DIRECTORY} />,
    );
    unmount();
    expect(jest.getTimerCount()).toBe(before);
  });
});
