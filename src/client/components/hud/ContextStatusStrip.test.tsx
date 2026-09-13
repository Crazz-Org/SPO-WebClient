/**
 * ContextStatusStrip — the cadence and the silences.
 *
 * The scenario test in `src/mock-server/scenarios/context-status-scenario.test.tsx`
 * proves the strip against the real protocol path. This file pins the parts that
 * are the component's own: the two triggers (a camera move, and Voyager's 20 s
 * idle refresh — `MapIsoHandler.pas:188`), the renderer not being up yet, and an
 * empty answer producing no bar at all (`Kernel/World.pas:4243`).
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { ContextStatusStrip, CAMERA_POLL_MS, IDLE_REFRESH_MS } from './ContextStatusStrip';
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

function renderStrip(onRequestContextStatus: jest.Mock) {
  const callbacks = { onRequestContextStatus } as unknown as ClientCallbacks;
  return render(
    <ClientContext.Provider value={callbacks}>
      <ContextStatusStrip />
    </ClientContext.Provider>,
  );
}

describe('ContextStatusStrip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useMapStore.setState({ source: null });
    useBuildingStore.getState().clearFocus();
  });

  afterEach(() => {
    jest.useRealTimers();
    useMapStore.setState({ source: null });
  });

  it('states Voyager\'s cadence in the code', () => {
    expect(IDLE_REFRESH_MS).toBe(20_000);
    expect(CAMERA_POLL_MS).toBe(1000);
  });

  it('asks nothing while the renderer is not up', async () => {
    const ask = jest.fn().mockResolvedValue('never');

    renderStrip(ask);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS * 3); });

    expect(ask).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the sentence for the tile under the camera', async () => {
    setCamera(706, 436);
    const ask = jest.fn().mockResolvedValue('Podan');

    renderStrip(ask);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Podan'));
    expect(ask).toHaveBeenCalledWith(706, 436);
  });

  it('does not ask again while the camera stays on the same tile, until the 20 s idle refresh', async () => {
    setCamera(706, 436);
    const ask = jest.fn().mockResolvedValue('Podan');

    renderStrip(ask);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));

    // Nineteen polls on the same tile, no new traffic.
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS * 19); });
    expect(ask).toHaveBeenCalledTimes(1);

    // The twentieth crosses IDLE_REFRESH_MS.
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS); });
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
  });

  it('asks again as soon as the camera reaches another tile', async () => {
    setCamera(706, 436);
    const ask = jest.fn().mockResolvedValue('Podan');

    renderStrip(ask);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));

    setCamera(120, 120);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS); });

    await waitFor(() => expect(ask).toHaveBeenCalledWith(120, 120));
  });

  it('hides the strip rather than showing an empty bar when the world answers ""', async () => {
    setCamera(120, 120);
    const ask = jest.fn().mockResolvedValue('   ');

    renderStrip(ask);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS); });

    expect(ask).toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('rounds a fractional camera position to whole tiles', async () => {
    useMapStore.setState({
      source: { getCameraPosition: () => ({ x: 705.6, y: 435.4 }) } as unknown as MinimapRendererAPI,
    });
    const ask = jest.fn().mockResolvedValue('Podan');

    renderStrip(ask);
    await waitFor(() => expect(ask).toHaveBeenCalledWith(706, 435));
  });

  it('stands down while a building is selected and asks nothing', async () => {
    setCamera(706, 436);
    useBuildingStore.setState({
      focusedBuilding: { id: '1', name: 'Farm', x: 706, y: 436 },
    } as unknown as Parameters<typeof useBuildingStore.setState>[0]);
    const ask = jest.fn().mockResolvedValue('Podan');

    renderStrip(ask);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS * 3); });

    expect(ask).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('drops a late answer for a tile the camera has already left', async () => {
    setCamera(706, 436);
    let resolveFirst: (v: string) => void = () => undefined;
    const ask = jest.fn()
      .mockImplementationOnce(() => new Promise<string>((r) => { resolveFirst = r; }))
      .mockResolvedValue('Kalisz');

    renderStrip(ask);
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));

    setCamera(120, 120);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS); });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Kalisz'));

    // The stale answer lands now — it must not overwrite the newer one.
    await act(async () => { resolveFirst('Podan'); });
    expect(screen.getByRole('status')).toHaveTextContent('Kalisz');
  });
});
