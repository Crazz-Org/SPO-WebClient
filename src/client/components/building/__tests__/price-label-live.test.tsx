/**
 * Both price sliders move their label with the thumb, before the debounced
 * write goes out — the General-tab card (ProductSaleCard via
 * ProductSummaryCards) and the Products-tab card (ProductCard).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { ProductSummaryCards } from '../PropertyTables';
import { ProductsPanel } from '../ProductsGroup';
import { PRICE_PERCENT_MAX } from '../trade-constants';
import { formatCurrency } from '@/shared/building-details';
import type { BuildingProductData } from '@/shared/types';

const product: BuildingProductData = {
  path: 'out/Fabric', name: 'Fabric', metaFluid: 'Fabric', quality: '80', pricePc: '100',
  avgPrice: '50', marketPrice: '60', lastFluid: '', connectionCount: 0, connections: [],
};

function slider(): HTMLInputElement {
  const el = document.querySelector('input[type="range"]');
  if (!(el instanceof HTMLInputElement)) throw new Error('no price slider');
  return el;
}

describe('the price label follows the drag', () => {
  beforeEach(() => {
    resetStores();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('General tab: label moves at once, before the write is sent', () => {
    const onPropertyChange = jest.fn();
    renderWithProviders(
      <ProductSummaryCards products={[product]} canEdit onPropertyChange={onPropertyChange} />,
    );
    expect(screen.getByText(`${formatCurrency(60)} (100%)`)).toBeTruthy();
    expect(slider().max).toBe(String(PRICE_PERCENT_MAX));

    fireEvent.change(slider(), { target: { value: '150' } });

    expect(screen.getByText(`${formatCurrency(90)} (150%)`)).toBeTruthy();
    expect(onPropertyChange).not.toHaveBeenCalled();
  });

  it('General tab: a new server value re-seeds the label', () => {
    const { rerender } = renderWithProviders(
      <ProductSummaryCards products={[product]} canEdit onPropertyChange={() => undefined} />,
    );
    rerender(
      <ProductSummaryCards products={[{ ...product, pricePc: '200' }]} canEdit onPropertyChange={() => undefined} />,
    );
    expect(screen.getByText(`${formatCurrency(120)} (200%)`)).toBeTruthy();
  });

  it('General tab: without a market price the label is the bare percentage', () => {
    renderWithProviders(
      <ProductSummaryCards products={[{ ...product, marketPrice: '0' }]} canEdit onPropertyChange={() => undefined} />,
    );
    fireEvent.change(slider(), { target: { value: '120' } });
    expect(screen.getByText('120%', { selector: 'span:not([class*="sliderValue"])' })).toBeTruthy();
  });

  it('Products tab: the dollar label moves at once', () => {
    renderWithProviders(
      <ProductsPanel products={[product]} canEdit buildingX={10} buildingY={20} onPropertyChange={() => undefined} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fabric/ }));
    expect(slider().max).toBe(String(PRICE_PERCENT_MAX));
    expect(screen.getByText(formatCurrency(60))).toBeTruthy();

    fireEvent.change(slider(), { target: { value: '150' } });

    expect(screen.getByText(formatCurrency(90))).toBeTruthy();
  });
});
