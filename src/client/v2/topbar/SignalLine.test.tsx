/**
 * SignalLine — the town sentence and the newest world event in one line under the TopBar:
 * each half shown on its own, nothing at all when both are silent, the event button moving
 * the camera, and the right edge shifting with an open surface (not in connect mode).
 */

import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useMapStore } from '../../store/map-store';
import { useUiStore } from '../../store/ui-store';
import { useBuildingStore } from '../../store/building-store';
import type { MinimapRendererAPI } from '../../ui/minimap-colormap';
import type { WorldEventLine } from '../../../shared/types';
import { SignalLine } from './SignalLine';

const EVENT: WorldEventLine = { date: '18/02/2026', kind: 1, text: 'Farm built in Helartia', x: 706, y: 436 };

function renderLine(town: string, event: WorldEventLine | null) {
  const onRequestContextStatus = jest.fn().mockResolvedValue(town);
  const onRequestWorldEvent = jest.fn().mockResolvedValue(event);
  const view = renderWithProviders(<SignalLine />, {
    clientCallbacks: createSpiedCallbacks({ onRequestContextStatus, onRequestWorldEvent }),
  });
  return { ...view, onRequestContextStatus, onRequestWorldEvent };
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('SignalLine', () => {
  let hiddenSpy: jest.SpyInstance;
  const centerOn = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    hiddenSpy = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    centerOn.mockClear();
    useMapStore.setState({
      source: { getCameraPosition: () => ({ x: 100, y: 200 }), centerOn } as unknown as MinimapRendererAPI,
    });
    useBuildingStore.getState().clearFocus();
    useUiStore.getState().clearSurfaces();
    useUiStore.getState().setConnectMode(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    hiddenSpy.mockRestore();
    useMapStore.setState({ source: null });
  });

  it('renders nothing when the town and the event are both silent', async () => {
    const { container, onRequestContextStatus, onRequestWorldEvent } = renderLine('  ', null);
    await flush();
    expect(onRequestContextStatus).toHaveBeenCalledWith(100, 200);
    expect(onRequestWorldEvent).toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });

  it('shows the town sentence alone, as a polite status', async () => {
    renderLine('Podan — 1,204 inhabitants', null);
    await flush();
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0].textContent).toBe('Podan — 1,204 inhabitants');
    expect(regions[0].getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('v2-signal-line').className).toContain('line');
  });

  it('shows both halves, the event as a button that moves the camera there', async () => {
    renderLine('Podan', EVENT);
    await flush();
    const regions = screen.getAllByRole('status');
    expect(regions.map((r) => r.textContent)).toEqual(['Podan', '18/02/2026 — Farm built in Helartia']);
    expect(regions[1].getAttribute('title')).toBe('18/02/2026 — Farm built in Helartia');

    fireEvent.click(screen.getByRole('button', { name: 'Go to (706, 436)' }));
    expect(centerOn).toHaveBeenCalledWith(706, 436);
    expect(useMapStore.getState().history).toContainEqual({ x: 706, y: 436 });
  });

  it('an event without a tile is plain text, not a button', async () => {
    renderLine('', { date: '18/02/2026', kind: 0, text: 'No coords here' });
    await flush();
    expect(screen.getByRole('status').textContent).toBe('18/02/2026 — No coords here');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides the town half while a building is focused', async () => {
    renderLine('Podan', EVENT);
    await flush();
    act(() => {
      useBuildingStore.setState({
        focusedBuilding: { id: '1', name: 'Farm', x: 706, y: 436 },
      } as unknown as Parameters<typeof useBuildingStore.setState>[0]);
    });
    expect(screen.queryByText('Podan')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Farm built in Helartia');
  });

  it('shifts its right edge while a surface is open, but not in connect mode', async () => {
    renderLine('Podan', null);
    await flush();
    const line = screen.getByTestId('v2-signal-line');
    expect(line.className).not.toContain('shifted');

    act(() => useUiStore.getState().toggleLeftPanel('empire'));
    expect(line.className).toContain('shifted');

    act(() => useUiStore.getState().setConnectMode(true));
    expect(line.className).not.toContain('shifted');
  });
});
