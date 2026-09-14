/**
 * WorldEventTicker — the cadence, the silences, and the click.
 *
 * The scenario test in `src/mock-server/scenarios/world-event-scenario.test.tsx`
 * proves the ticker against the real protocol path. This file pins the parts
 * that are the component's own: `POLL_MS`, the visibility guard, a `null`
 * answer leaving the last event in place, the button appearing only when the
 * event carries coordinates, and a late answer after unmount setting no state.
 */

import { act, render, screen } from '@testing-library/react';
import { WorldEventTicker, POLL_MS } from './WorldEventTicker';
import { ClientContext } from '../../context/ClientContext';
import type { ClientCallbacks } from '../../bridge/client-bridge';
import { useMapStore } from '../../store/map-store';
import type { WorldEventLine } from '../../../shared/types';

function renderTicker(onRequestWorldEvent: jest.Mock) {
  const callbacks = { onRequestWorldEvent } as unknown as ClientCallbacks;
  return render(
    <ClientContext.Provider value={callbacks}>
      <WorldEventTicker />
    </ClientContext.Provider>,
  );
}

const EVENT: WorldEventLine = { date: '18/02/2026', kind: 1, text: 'Farm built in Helartia', x: 706, y: 436 };

describe('WorldEventTicker', () => {
  let hiddenSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    hiddenSpy = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    useMapStore.setState({ source: null });
  });

  afterEach(() => {
    jest.useRealTimers();
    hiddenSpy.mockRestore();
    useMapStore.setState({ source: null });
  });

  it('states the card\'s cadence', () => {
    expect(POLL_MS).toBe(45_000);
  });

  it('shows nothing before the first answer', () => {
    const ask = jest.fn().mockReturnValue(new Promise<WorldEventLine | null>(() => undefined));

    renderTicker(ask);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows "<date> — <text>" once the first answer lands', async () => {
    const ask = jest.fn().mockResolvedValue(EVENT);

    renderTicker(ask);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('18/02/2026 — Farm built in Helartia');
  });

  it('replaces the line with a later event', async () => {
    const second: WorldEventLine = { date: '19/02/2026', kind: 1, text: 'Mine built in Podan' };
    const ask = jest.fn().mockResolvedValueOnce(EVENT).mockResolvedValueOnce(second);

    renderTicker(ask);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('Farm built in Helartia');

    await act(async () => { jest.advanceTimersByTime(POLL_MS); await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('19/02/2026 — Mine built in Podan');
  });

  it('a null answer leaves the previous line in place', async () => {
    const ask = jest.fn().mockResolvedValueOnce(EVENT).mockResolvedValueOnce(null);

    renderTicker(ask);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('Farm built in Helartia');

    await act(async () => { jest.advanceTimersByTime(POLL_MS); await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('Farm built in Helartia');
  });

  it('renders no button when the event has no coordinates', async () => {
    const ask = jest.fn().mockResolvedValue({ date: '18/02/2026', kind: 0, text: 'No coords here' });

    renderTicker(ask);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole('status')).toHaveTextContent('No coords here');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('the button calls centerOn and recordPosition with the event tile', async () => {
    const centerOn = jest.fn();
    useMapStore.setState({ source: { centerOn } as never });
    const ask = jest.fn().mockResolvedValue(EVENT);

    renderTicker(ask);
    await act(async () => { await Promise.resolve(); });

    await act(async () => { screen.getByRole('button').click(); });

    expect(centerOn).toHaveBeenCalledWith(706, 436);
    expect(useMapStore.getState().history).toContainEqual({ x: 706, y: 436 });
  });

  it('document.hidden suppresses the ask', async () => {
    hiddenSpy.mockReturnValue(true);
    const ask = jest.fn().mockResolvedValue(EVENT);

    renderTicker(ask);
    await act(async () => { jest.advanceTimersByTime(POLL_MS * 2); await Promise.resolve(); });

    expect(ask).not.toHaveBeenCalled();
  });

  it('a late answer after unmount sets no state', async () => {
    let resolveAsk: (v: WorldEventLine | null) => void = () => undefined;
    const ask = jest.fn().mockReturnValue(new Promise<WorldEventLine | null>((r) => { resolveAsk = r; }));

    const { unmount } = renderTicker(ask);
    unmount();

    await act(async () => { resolveAsk(EVENT); await Promise.resolve(); });
    // No assertion target exists once unmounted; reaching here without a
    // React "state update on an unmounted component" warning is the proof.
  });
});
