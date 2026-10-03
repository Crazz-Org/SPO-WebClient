/**
 * useContextStatus — the v1 ContextStatusStrip cadence, re-read for the v2 SignalLine:
 * camera move or the 20 s idle refresh (MapIsoHandler.pas:188), nothing before the renderer,
 * nothing while a building is focused, and no late answer overwriting a newer one.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { useContextStatus } from './useContextStatus';
import { CAMERA_POLL_MS, IDLE_REFRESH_MS } from '../../components/hud/ContextStatusStrip';
import { ClientContext } from '../../context/ClientContext';
import type { ClientCallbacks } from '../../bridge/client-bridge';
import { useMapStore } from '../../store/map-store';
import { useBuildingStore } from '../../store/building-store';
import type { MinimapRendererAPI } from '../../ui/minimap-colormap';

function setCamera(x: number, y: number): void {
  useMapStore.setState({
    source: { getCameraPosition: () => ({ x, y }) } as unknown as MinimapRendererAPI,
  });
}

function Probe() {
  return <output data-testid="town">{useContextStatus()}</output>;
}

function renderProbe(onRequestContextStatus: jest.Mock) {
  const callbacks = { onRequestContextStatus } as unknown as ClientCallbacks;
  return render(
    <ClientContext.Provider value={callbacks}>
      <Probe />
    </ClientContext.Provider>,
  );
}

const town = () => screen.getByTestId('town').textContent;

describe('useContextStatus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useMapStore.setState({ source: null });
    useBuildingStore.getState().clearFocus();
  });

  afterEach(() => {
    jest.useRealTimers();
    useMapStore.setState({ source: null });
  });

  it('uses the v1 cadence (20 s idle, 1 s camera look)', () => {
    expect(IDLE_REFRESH_MS).toBe(20_000);
    expect(CAMERA_POLL_MS).toBe(1000);
  });

  it('asks nothing while the renderer is not up', async () => {
    const ask = jest.fn().mockResolvedValue('never');
    renderProbe(ask);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS * 3); });
    expect(ask).not.toHaveBeenCalled();
    expect(town()).toBe('');
  });

  it('returns the sentence for the rounded tile under the camera', async () => {
    useMapStore.setState({
      source: { getCameraPosition: () => ({ x: 705.6, y: 435.4 }) } as unknown as MinimapRendererAPI,
    });
    const ask = jest.fn().mockResolvedValue('Podan');
    renderProbe(ask);
    await waitFor(() => expect(town()).toBe('Podan'));
    expect(ask).toHaveBeenCalledWith(706, 435);
  });

  it('does not ask again on the same tile until the 20 s idle refresh', async () => {
    setCamera(706, 436);
    const ask = jest.fn().mockResolvedValue('Podan');
    renderProbe(ask);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));

    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS * 19); });
    expect(ask).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS); });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
  });

  it('asks again as soon as the camera reaches another tile', async () => {
    setCamera(706, 436);
    const ask = jest.fn().mockResolvedValue('Podan');
    renderProbe(ask);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));

    setCamera(120, 120);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS); });
    await waitFor(() => expect(ask).toHaveBeenCalledWith(120, 120));
  });

  it('stands down while a building is focused, and clears its sentence when one gets focused', async () => {
    setCamera(706, 436);
    const ask = jest.fn().mockResolvedValue('Podan');
    renderProbe(ask);
    await waitFor(() => expect(town()).toBe('Podan'));

    act(() => {
      useBuildingStore.setState({
        focusedBuilding: { id: '1', name: 'Farm', x: 706, y: 436 },
      } as unknown as Parameters<typeof useBuildingStore.setState>[0]);
    });
    expect(town()).toBe('');

    ask.mockClear();
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS * 25); });
    expect(ask).not.toHaveBeenCalled();
    expect(town()).toBe('');
  });

  it('drops a late answer for a tile the camera has already left', async () => {
    setCamera(706, 436);
    let resolveFirst: (v: string) => void = () => undefined;
    const ask = jest.fn()
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveFirst = r; }))
      .mockResolvedValue('Kalisz');
    renderProbe(ask);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));

    setCamera(120, 120);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS); });
    await waitFor(() => expect(town()).toBe('Kalisz'));

    await act(async () => { resolveFirst('Podan'); });
    expect(town()).toBe('Kalisz');
  });

  it('sets nothing and stops polling after unmount', async () => {
    setCamera(706, 436);
    let resolveAsk: (v: string) => void = () => undefined;
    const ask = jest.fn().mockImplementation(() => new Promise<string>((r) => { resolveAsk = r; }));
    const { unmount } = renderProbe(ask);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => { resolveAsk('Podan'); });
    setCamera(1, 1);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS * 5); });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
