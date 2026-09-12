/**
 * MapNavigationUI — right-click map context menu forwarding only.
 *
 * A real instance is constructed (covers field init + constructor); `setupRendererCallbacks`
 * is private, so it is invoked through a cast the same way the renderer's private handlers
 * are exercised in renderer-input.test.ts.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { MapNavigationUI } from './map-navigation-ui';

interface Internals {
  renderer: {
    setLoadZoneCallback: jest.Mock;
    setBuildingClickCallback: jest.Mock;
    setEmptyMapClickCallback: jest.Mock;
    setFetchFacilityDimensionsCallback: jest.Mock;
    setViewportChangedCallback: jest.Mock;
    setMapContextMenuCallback: jest.Mock;
  } | null;
  setupRendererCallbacks: () => void;
}

function fakeRenderer() {
  return {
    setLoadZoneCallback: jest.fn(),
    setBuildingClickCallback: jest.fn(),
    setEmptyMapClickCallback: jest.fn(),
    setFetchFacilityDimensionsCallback: jest.fn(),
    setViewportChangedCallback: jest.fn(),
    setMapContextMenuCallback: jest.fn(),
  };
}

describe('MapNavigationUI — map context menu forwarding', () => {
  it('forwards the renderer callback to the registered onMapContextMenu handler', () => {
    const nav = new MapNavigationUI({} as HTMLElement, 'planitia');
    const renderer = fakeRenderer();
    const internals = nav as unknown as Internals;
    internals.renderer = renderer;

    const onMapContextMenu = jest.fn();
    nav.setOnMapContextMenu(onMapContextMenu);
    internals.setupRendererCallbacks();

    expect(renderer.setMapContextMenuCallback).toHaveBeenCalledTimes(1);
    const forwarded = renderer.setMapContextMenuCallback.mock.calls[0][0] as (
      clientX: number, clientY: number, tileX: number, tileY: number,
    ) => void;
    forwarded(100, 50, 10, 5);

    expect(onMapContextMenu).toHaveBeenCalledWith(100, 50, 10, 5);
  });

  it('does not throw when no handler is registered', () => {
    const nav = new MapNavigationUI({} as HTMLElement, 'planitia');
    const renderer = fakeRenderer();
    const internals = nav as unknown as Internals;
    internals.renderer = renderer;

    internals.setupRendererCallbacks();
    const forwarded = renderer.setMapContextMenuCallback.mock.calls[0][0] as (
      clientX: number, clientY: number, tileX: number, tileY: number,
    ) => void;

    expect(() => forwarded(0, 0, 0, 0)).not.toThrow();
  });
});
