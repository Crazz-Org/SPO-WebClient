/**
 * useWorldEvent — the v1 WorldEventTicker reading, for the v2 SignalLine: POLL_MS, the
 * document.hidden guard (PickEvent is destructive), a null answer keeping the last event,
 * and no state after unmount.
 */

import { act, render, screen } from '@testing-library/react';
import { useWorldEvent } from './useWorldEvent';
import { POLL_MS } from '../../components/hud/WorldEventTicker';
import { ClientContext } from '../../context/ClientContext';
import type { ClientCallbacks } from '../../bridge/client-bridge';
import type { WorldEventLine } from '../../../shared/types';

function Probe() {
  const event = useWorldEvent();
  return <output data-testid="event">{event ? `${event.date}|${event.text}` : 'none'}</output>;
}

function renderProbe(onRequestWorldEvent: jest.Mock) {
  const callbacks = { onRequestWorldEvent } as unknown as ClientCallbacks;
  return render(
    <ClientContext.Provider value={callbacks}>
      <Probe />
    </ClientContext.Provider>,
  );
}

const EVENT: WorldEventLine = { date: '18/02/2026', kind: 1, text: 'Farm built in Helartia', x: 706, y: 436 };
const shown = () => screen.getByTestId('event').textContent;
const flush = () => act(async () => { await Promise.resolve(); });

describe('useWorldEvent', () => {
  let hiddenSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    hiddenSpy = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    hiddenSpy.mockRestore();
  });

  it('uses the ticker\'s 45 s cadence', () => {
    expect(POLL_MS).toBe(45_000);
  });

  it('is null before the first answer, then the event', async () => {
    const ask = jest.fn().mockResolvedValue(EVENT);
    renderProbe(ask);
    expect(shown()).toBe('none');
    await flush();
    expect(shown()).toBe('18/02/2026|Farm built in Helartia');
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('replaces the event on the next poll, and a null answer keeps the last one', async () => {
    const second: WorldEventLine = { date: '19/02/2026', kind: 1, text: 'Mine built in Podan' };
    const ask = jest.fn()
      .mockResolvedValueOnce(EVENT)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(null);
    renderProbe(ask);
    await flush();

    await act(async () => { jest.advanceTimersByTime(POLL_MS); await Promise.resolve(); });
    expect(shown()).toBe('19/02/2026|Mine built in Podan');

    await act(async () => { jest.advanceTimersByTime(POLL_MS); await Promise.resolve(); });
    expect(shown()).toBe('19/02/2026|Mine built in Podan');
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('asks nothing while the tab is hidden', async () => {
    hiddenSpy.mockReturnValue(true);
    const ask = jest.fn().mockResolvedValue(EVENT);
    renderProbe(ask);
    await act(async () => { jest.advanceTimersByTime(POLL_MS * 2); await Promise.resolve(); });
    expect(ask).not.toHaveBeenCalled();
  });

  it('a late answer after unmount sets no state, and the poll stops', async () => {
    let resolveAsk: (v: WorldEventLine | null) => void = () => undefined;
    const ask = jest.fn().mockReturnValue(new Promise<WorldEventLine | null>((r) => { resolveAsk = r; }));
    const { unmount } = renderProbe(ask);
    unmount();
    await act(async () => { resolveAsk(EVENT); await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(POLL_MS * 2); });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
