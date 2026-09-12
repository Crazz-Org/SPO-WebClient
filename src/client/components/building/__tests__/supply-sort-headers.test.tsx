/**
 * The supplier table's Price and Quality headers change the server-side sort.
 *
 * Reference client: `Voyager/SupplySheetForm.pas:1005` shows the mark only when
 * QPSorted = '1'; `:1006-1019` puts it on Quality when SortMode = '1' and on
 * Price otherwise, before any click; `:1187` accepts a column click only for the
 * owner of the facility, with a fluid id, and with that mark shown; `:1197` and
 * `:1204` fork `RDOSetInputSortMode` with mode 0 (Price) and 1 (Quality).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { SuppliesPanel } from '../SuppliesGroup';
import type { BuildingSupplyData, BuildingConnectionData } from '@/shared/types';

const X = 10;
const Y = 20;

const conn = (facilityName: string): BuildingConnectionData => ({
  facilityName, companyName: 'Yellow Inc.', createdBy: 'SPO_test3', price: '100',
  overprice: '10', lastValue: '900', cost: '$12', quality: '95%', connected: true,
  x: 40, y: 50,
});

/** The table only renders for a gate that has at least one supplier row. */
const makeSupply = (overrides: Partial<BuildingSupplyData>): BuildingSupplyData => ({
  path: 'in/Cotton', name: 'Cotton', metaFluid: 'Cotton', fluidValue: '1200',
  connectionCount: 1, connections: [conn('Farm A')], ...overrides,
});

/** Render an opened gate, with the write callback spied. */
function openGate(supply: BuildingSupplyData, canEdit = true) {
  const onSetBuildingProperty = jest.fn();
  const result = renderWithProviders(
    <SuppliesPanel supplies={[supply]} canEdit={canEdit} buildingX={X} buildingY={Y} />,
    { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
  );
  fireEvent.click(screen.getByRole('button', { name: /Cotton/ }));
  return { ...result, onSetBuildingProperty };
}

/** The header cell itself — the `<th>` is what carries `aria-sort`. */
function headerCell(label: string): HTMLElement {
  const cell = screen.getByRole('columnheader', { name: label });
  return cell;
}

beforeEach(() => resetStores());

describe('a sortable gate, owned', () => {
  it('clicking Price sends mode 0 and clicking Quality sends mode 1', () => {
    const { onSetBuildingProperty } = openGate(makeSupply({ qpSorted: '1', sortMode: '0' }));

    fireEvent.click(screen.getByRole('button', { name: 'Price' }));
    expect(onSetBuildingProperty).toHaveBeenCalledTimes(1);
    expect(onSetBuildingProperty).toHaveBeenCalledWith(
      X, Y, 'RDOSetInputSortMode', '0', { fluidId: 'Cotton' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Quality' }));
    expect(onSetBuildingProperty).toHaveBeenCalledTimes(2);
    expect(onSetBuildingProperty).toHaveBeenLastCalledWith(
      X, Y, 'RDOSetInputSortMode', '1', { fluidId: 'Cotton' },
    );
  });

  it('the clicked header takes the mark at once, before any re-read', () => {
    openGate(makeSupply({ qpSorted: '1', sortMode: '0' }));

    expect(headerCell('Price').getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(screen.getByRole('button', { name: 'Quality' }));
    expect(headerCell('Quality').getAttribute('aria-sort')).toBe('ascending');
    expect(headerCell('Price').getAttribute('aria-sort')).toBeNull();
  });
});

describe('the mark the gate opens with', () => {
  it('sortMode 1 marks Quality and nothing else', () => {
    openGate(makeSupply({ qpSorted: '1', sortMode: '1' }));

    expect(headerCell('Quality').getAttribute('aria-sort')).toBe('ascending');
    expect(headerCell('Price').getAttribute('aria-sort')).toBeNull();
  });

  it('sortMode 0 marks Price', () => {
    openGate(makeSupply({ qpSorted: '1', sortMode: '0' }));

    expect(headerCell('Price').getAttribute('aria-sort')).toBe('ascending');
    expect(headerCell('Quality').getAttribute('aria-sort')).toBeNull();
  });

  it('a gate that came back without a sortMode falls back to Price', () => {
    openGate(makeSupply({ qpSorted: '1' }));

    expect(headerCell('Price').getAttribute('aria-sort')).toBe('ascending');
    expect(headerCell('Quality').getAttribute('aria-sort')).toBeNull();
  });

  it('follows a sortMode the server sends after the card has already rendered', () => {
    // The gate header is read when the gate is opened, so the first render of an
    // opened card can predate the value — seeding once would leave the mark on
    // Price for a gate the server sorts by quality.
    const { rerender } = openGate(makeSupply({ qpSorted: '1' }));
    expect(headerCell('Price').getAttribute('aria-sort')).toBe('ascending');

    rerender(
      <SuppliesPanel
        supplies={[makeSupply({ qpSorted: '1', sortMode: '1' })]}
        canEdit
        buildingX={X}
        buildingY={Y}
      />,
    );

    expect(headerCell('Quality').getAttribute('aria-sort')).toBe('ascending');
    expect(headerCell('Price').getAttribute('aria-sort')).toBeNull();
  });

  it('a gate being re-listed drops to no sortMode without moving the mark', () => {
    const { rerender } = openGate(makeSupply({ qpSorted: '1', sortMode: '1' }));
    expect(headerCell('Quality').getAttribute('aria-sort')).toBe('ascending');

    rerender(
      <SuppliesPanel
        supplies={[makeSupply({ qpSorted: '1', sortMode: undefined })]}
        canEdit
        buildingX={X}
        buildingY={Y}
      />,
    );

    expect(headerCell('Quality').getAttribute('aria-sort')).toBe('ascending');
  });
});

describe('a gate the headers must leave alone', () => {
  /** Plain text, no button, no mark, and a click on the text writes nothing. */
  function expectInert(container: HTMLElement, onSetBuildingProperty: ReturnType<typeof jest.fn>): void {
    expect(screen.queryByRole('button', { name: 'Price' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quality' })).toBeNull();
    expect(container.querySelectorAll('[aria-sort]')).toHaveLength(0);

    fireEvent.click(headerCell('Price'));
    fireEvent.click(headerCell('Quality'));
    expect(onSetBuildingProperty).not.toHaveBeenCalled();
  }

  it('QPSorted is not 1 — there is no quality/price sort to change', () => {
    const { container, onSetBuildingProperty } = openGate(
      makeSupply({ qpSorted: '0', sortMode: '1' }),
    );
    expectInert(container, onSetBuildingProperty);
  });

  it('a visitor who does not own the facility', () => {
    const { container, onSetBuildingProperty } = openGate(
      makeSupply({ qpSorted: '1', sortMode: '0' }), false,
    );
    expectInert(container, onSetBuildingProperty);
  });

  it('a gate read that yielded no fluid id to address the write with', () => {
    const { container, onSetBuildingProperty } = openGate(
      makeSupply({ metaFluid: '', qpSorted: '1', sortMode: '0' }),
    );
    expectInert(container, onSetBuildingProperty);
  });
});
