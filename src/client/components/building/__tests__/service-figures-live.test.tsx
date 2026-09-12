/**
 * The General tab's Offer and Demand come off the block, not out of the cache
 * (issue 574).
 *
 * `srvSupplies{i}` / `srvDemands{i}` are cached columns that only move with the
 * 30-second whole-tab refresh. The reference client never drew those two
 * figures: `threadedRefresh` polls `RDOGetDemand(CurrentFinger)` and
 * `RDOGetSupply(CurrentFinger)` on its own timer, for the selected finger alone
 * (Voyager/SrvGeneralSheetForm.pas:398-425).
 *
 * The figures the poll answers here come from the `service-figures` L1
 * scenario, and they deliberately disagree with the cached columns the
 * `building-details` scenario serves — so a card still reading the cache shows
 * a different number, and these assertions can tell the two apart.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { useGameStore } from '../../../store/game-store';
import { PropertyGroup } from '../PropertyGroup';
import { SERVICE_FIGURES_POLL_MS } from '../useServiceFigures';
import {
  SERVICE_FIGURES_ANSWERS,
  SERVICE_FIGURES_CACHED,
} from '@/mock-server/scenarios/service-figures-scenario';
import type { BuildingPropertyValue, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

const X = 118;
const Y = 226;
/** Its own visual class: `registerInspectorTabs` caches per class. */
const SRV_CLASS = '574';

const SRV_TABS: BuildingDetailsTab[] = [
  { id: 'srvGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'SrvGeneral' },
];

/** The cached columns of both services — the same values for each, so only the poll can differ. */
const CACHED: Record<string, string> = {
  Creator: 'Yellow Inc.',
  Cost: '180000',
  ServiceCount: '2',
  'srvNames0.0': 'Pharmaceutics',
  'srvNames1.0': 'Organic Food',
  srvPrices0: '120',
  srvPrices1: '100',
  srvSupplies0: SERVICE_FIGURES_CACHED.srvSupplies,
  srvDemands0: SERVICE_FIGURES_CACHED.srvDemands,
  srvSupplies1: SERVICE_FIGURES_CACHED.srvSupplies,
  srvDemands1: SERVICE_FIGURES_CACHED.srvDemands,
};

function seed(): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-574',
    x: X, y: Y,
    visualClass: SRV_CLASS,
    templateName: 'Drug Store',
    buildingName: 'Drug Store 10',
    ownerName: 'Yellow Inc.',
    securityId: 'sec-1',
    canGovern: false,
    tabs: SRV_TABS,
    groups: { srvGeneral: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ isLoading: false, currentTab: 'srvGeneral', isOwner: true });
}

const PROPS: BuildingPropertyValue[] =
  Object.entries(CACHED).map(([name, value]) => ({ name, value })) as BuildingPropertyValue[];

/** `onRequestServiceFigures` answering what the block answers in the L1 scenario. */
function figuresSpy() {
  return jest.fn(async () => ({
    supply: SERVICE_FIGURES_ANSWERS.supply,
    demand: SERVICE_FIGURES_ANSWERS.demand,
  }));
}

function renderTab(onRequestServiceFigures: (...a: unknown[]) => unknown) {
  return renderWithProviders(
    <PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />,
    { clientCallbacks: createSpiedCallbacks({ onRequestServiceFigures }) },
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  useGameStore.setState({ status: 'connected' });
  seed();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the selected service is polled off the block', () => {
  it('draws the cached columns until the first answer, then the live figures', async () => {
    const spy = figuresSpy();
    renderTab(spy as never);

    // Before the reply resolves, the cache is all there is.
    expect(screen.getAllByText(`Supply ${SERVICE_FIGURES_CACHED.srvSupplies}%`)).toHaveLength(2);

    await act(async () => { await Promise.resolve(); });

    // The selected card (the first) now shows what the block answered, and the
    // other one still shows its cached column.
    expect(screen.getByText(`Supply ${SERVICE_FIGURES_ANSWERS.supply}%`)).toBeTruthy();
    expect(screen.getByText(`Local Demand: ${SERVICE_FIGURES_ANSWERS.demand}%`)).toBeTruthy();
    expect(screen.getAllByText(`Supply ${SERVICE_FIGURES_CACHED.srvSupplies}%`)).toHaveLength(1);
    expect(screen.getAllByText(`Local Demand: ${SERVICE_FIGURES_CACHED.srvDemands}%`)).toHaveLength(1);
  });

  it('costs one call per tick whatever the service count, always for the selected index', async () => {
    const spy = figuresSpy();
    renderTab(spy as never);
    await act(async () => { await Promise.resolve(); });

    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(SERVICE_FIGURES_POLL_MS); });

    // Two services on screen, still one call — the poll is per selection, not
    // per card.
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call).toEqual([X, Y, 0]);
    }
  });

  it('follows the selection: clicking the second service polls index 1', async () => {
    const spy = figuresSpy();
    renderTab(spy as never);
    await act(async () => { await Promise.resolve(); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Organic Food' }));
    });

    expect(spy.mock.calls[spy.mock.calls.length - 1]).toEqual([X, Y, 1]);
    expect(screen.getByRole('button', { name: 'Organic Food' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pharmaceutics' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows no stale figures for a newly selected service', async () => {
    // Voyager's `Finger = CurrentFinger` guard (:424): the previous service's
    // numbers are not this one's, so the card falls back to its own cached
    // column until the block answers for it.
    const spy = jest.fn(async () => ({ supply: SERVICE_FIGURES_ANSWERS.supply, demand: SERVICE_FIGURES_ANSWERS.demand }));
    let release: (() => void) | undefined;
    renderTab(spy as never);
    await act(async () => { await Promise.resolve(); });

    spy.mockImplementation(() => new Promise((resolve) => {
      release = () => { resolve({ supply: SERVICE_FIGURES_ANSWERS.supply, demand: SERVICE_FIGURES_ANSWERS.demand }); };
    }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Organic Food' }));
    });

    expect(screen.getAllByText(`Supply ${SERVICE_FIGURES_CACHED.srvSupplies}%`)).toHaveLength(2);
    expect(screen.queryByText(`Supply ${SERVICE_FIGURES_ANSWERS.supply}%`)).toBeNull();

    await act(async () => { release?.(); await Promise.resolve(); });
    expect(screen.getByText(`Supply ${SERVICE_FIGURES_ANSWERS.supply}%`)).toBeTruthy();
  });

  it('stops when the tab closes', async () => {
    const spy = figuresSpy();
    const { unmount } = renderTab(spy as never);
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => { jest.advanceTimersByTime(SERVICE_FIGURES_POLL_MS * 3); });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sends nothing at all while disconnected', async () => {
    useGameStore.setState({ status: 'disconnected' });
    const spy = figuresSpy();
    renderTab(spy as never);

    await act(async () => { jest.advanceTimersByTime(SERVICE_FIGURES_POLL_MS * 2); });

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getAllByText(`Supply ${SERVICE_FIGURES_CACHED.srvSupplies}%`)).toHaveLength(2);
  });

  it('skips a tick while the document is hidden', async () => {
    const hidden = jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const spy = figuresSpy();
    renderTab(spy as never);
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalledTimes(1);

    hidden.mockReturnValue(true);
    await act(async () => { jest.advanceTimersByTime(SERVICE_FIGURES_POLL_MS); });
    expect(spy).toHaveBeenCalledTimes(1);

    hidden.mockReturnValue(false);
    await act(async () => { jest.advanceTimersByTime(SERVICE_FIGURES_POLL_MS); });
    expect(spy).toHaveBeenCalledTimes(2);

    hidden.mockRestore();
  });
});

describe('the Sales column', () => {
  function renderTabWithProps(props: BuildingPropertyValue[], onRequestServiceFigures: (...a: unknown[]) => unknown) {
    return renderWithProviders(
      <PropertyGroup properties={props} buildingX={X} buildingY={Y} />,
      { clientCallbacks: createSpiedCallbacks({ onRequestServiceFigures }) },
    );
  }

  it('renders blank when srvSales is absent from the cache', () => {
    renderTab(figuresSpy() as never);

    expect(screen.queryByText(/^Sales: /)).toBeNull();
    expect(screen.queryByText('Sales: 0%')).toBeNull();
  });

  it('shows the cached srvSales value per service when present', () => {
    const propsWithSales: BuildingPropertyValue[] = [
      ...PROPS,
      { name: 'srvSales0', value: '80' } as BuildingPropertyValue,
      { name: 'srvSales1', value: '35' } as BuildingPropertyValue,
    ];
    renderTabWithProps(propsWithSales, figuresSpy() as never);

    expect(screen.getByText('Sales: 80%')).toBeTruthy();
    expect(screen.getByText('Sales: 35%')).toBeTruthy();
  });
});
