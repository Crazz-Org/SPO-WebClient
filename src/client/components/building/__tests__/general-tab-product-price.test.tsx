/**
 * The General tab's product price slider writes the same request as the
 * Products tab's (issue 1132), and both show the write's feedback on the key
 * the write actually records.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import { ProductsPanel } from '../ProductsGroup';
import { ServiceCardList } from '../PropertyTables';
import { setBuildingProperty } from '../../../handlers/building-action-handler';
import type { ClientHandlerContext } from '../../../handlers/client-context';
import type { PropertyDefinition } from '@/shared/building-details';
import type { BuildingDetailsResponse, BuildingProductData } from '@/shared/types';

const X = 31;
const Y = 47;

function makeProduct(metaFluid: string): BuildingProductData {
  return {
    path: 'out/Chemicals', name: 'Chemicals', metaFluid, pricePc: '100', avgPrice: '50',
    marketPrice: '60', quality: '80', lastFluid: '', connectionCount: 0, connections: [],
  };
}

function seed(product: BuildingProductData): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-1132',
    x: X, y: Y,
    visualClass: '91132',
    templateName: 'Chemical Plant',
    buildingName: 'Plant',
    ownerName: 'Yellow Inc.',
    securityId: 'sec-1',
    canGovern: false,
    tabs: [
      { id: 'indGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'IndGeneral' },
      { id: 'products', name: 'PRODUCTS', order: 1, icon: 'P', handlerName: 'Products' },
    ],
    groups: { indGeneral: [] },
    products: [product],
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ isLoading: false, currentTab: 'indGeneral', isOwner: true });
}

const PROPS = [{ name: 'Name', value: 'Plant' }];

function generalSlider(): HTMLInputElement {
  const label = screen.getByText('Products');
  const card = label.parentElement as HTMLElement;
  return within(card).getByRole('slider') as HTMLInputElement;
}

function moveAndFlush(slider: HTMLInputElement, value: string): void {
  fireEvent.change(slider, { target: { value } });
  act(() => { jest.advanceTimersByTime(300); });
}

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the General-tab product price slider', () => {
  it('sends the exact request the Products tab sends for the same product', () => {
    seed(makeProduct('Chemicals'));
    const onSetBuildingProperty = jest.fn();
    const callbacks = createSpiedCallbacks({ onSetBuildingProperty });
    const { unmount } = renderWithProviders(
      <PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />,
      { clientCallbacks: callbacks },
    );

    moveAndFlush(generalSlider(), '150');
    expect(onSetBuildingProperty).toHaveBeenCalledWith(X, Y, 'RDOSetOutputPrice', '150', { fluidId: 'Chemicals' });
    unmount();

    act(() => { useBuildingStore.setState({ currentTab: 'products' }); });
    renderWithProviders(
      <PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />,
      { clientCallbacks: callbacks },
    );
    fireEvent.click(screen.getByRole('button', { name: /Chemicals/ }));
    moveAndFlush(screen.getByRole('slider') as HTMLInputElement, '150');

    expect(onSetBuildingProperty).toHaveBeenCalledTimes(2);
    expect(onSetBuildingProperty.mock.calls[1]).toEqual(onSetBuildingProperty.mock.calls[0]);
  });

  it('is disabled and sends nothing for a product with no metaFluid', () => {
    seed(makeProduct(''));
    const onSetBuildingProperty = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />,
      { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
    );

    const slider = generalSlider();
    expect(slider.disabled).toBe(true);
    moveAndFlush(slider, '150');
    expect(onSetBuildingProperty).not.toHaveBeenCalled();
  });
});

describe('a refused price write is shown on both cards', () => {
  it('lights the SaveIndicator of the General card and the Products card', async () => {
    const product = makeProduct('Chemicals');
    seed(product);
    renderWithProviders(
      <>
        <PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />
        <ProductsPanel products={[product]} canEdit buildingX={X} buildingY={Y} onPropertyChange={() => undefined} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Chemicals/ }));

    const ctx = {
      sendRequest: jest.fn(async () => ({ success: false })),
      inFlightSetProperty: new Map(),
    } as unknown as ClientHandlerContext;
    await act(async () => {
      await setBuildingProperty(ctx, X, Y, 'RDOSetOutputPrice', '150', { fluidId: 'Chemicals' });
    });

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) {
      expect(alert.textContent).toContain('Failed');
      expect(alert.textContent).toContain('Server rejected the change');
    }
  });
});

describe('the service cards keep their two-argument call', () => {
  it('ServiceCardList sends srvPrices0 with two arguments, slider enabled', () => {
    const def: PropertyDefinition = {
      rdoName: 'srv',
      displayName: 'Services',
      type: 'TABLE',
      columns: [
        { rdoSuffix: 'srvNames', label: 'Name', type: 'TEXT' },
        { rdoSuffix: 'srvPrices', label: 'Price', type: 'PERCENTAGE', editable: true, max: 500, step: 10 },
        { rdoSuffix: 'srvMarketPrices', label: 'Market', type: 'CURRENCY' },
        { rdoSuffix: 'srvAvgPrices', label: 'Avg', type: 'PERCENTAGE' },
      ],
    } as PropertyDefinition;
    const valueMap = new Map([['srvNames0', 'Food'], ['srvPrices0', '100'], ['srvMarketPrices0', '10'], ['srvAvgPrices0', '90']]);
    const onPropertyChange = jest.fn();
    renderWithProviders(
      <ServiceCardList def={def} rowCount={1} valueMap={valueMap} canEdit buildingX={X} buildingY={Y} onPropertyChange={onPropertyChange} />,
    );

    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    moveAndFlush(slider, '120');
    expect(onPropertyChange).toHaveBeenCalledWith('srvPrices0', 120);
    expect(onPropertyChange.mock.calls[0]).toHaveLength(2);
  });
});
