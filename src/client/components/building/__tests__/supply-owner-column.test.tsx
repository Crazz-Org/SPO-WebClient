/**
 * The supplier table's Owner column shows the tycoon who created the connection, not the
 * company name. Reference client: `Voyager/SupplySheetForm.pas:1038` puts `cnxCreatedBy` in
 * that column, the first sub-item after the facility name.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { SuppliesPanel } from '../SuppliesGroup';
import type { BuildingSupplyData, BuildingConnectionData } from '@/shared/types';

const X = 10;
const Y = 20;

const conn = (overrides: Partial<BuildingConnectionData>): BuildingConnectionData => ({
  facilityName: 'Farm A', companyName: 'Vito Holdings', createdBy: 'Vito', price: '100',
  overprice: '10', lastValue: '900', cost: '$12', quality: '95%', connected: true,
  x: 40, y: 50, ...overrides,
});

const makeSupply = (overrides: Partial<BuildingSupplyData>): BuildingSupplyData => ({
  path: 'in/Cotton', name: 'Cotton', metaFluid: 'Cotton', fluidValue: '1200',
  connectionCount: 1, connections: [conn({})], ...overrides,
});

function openGate(supply: BuildingSupplyData, canEdit = true) {
  const onSetBuildingProperty = jest.fn();
  const result = renderWithProviders(
    <SuppliesPanel supplies={[supply]} canEdit={canEdit} buildingX={X} buildingY={Y} />,
    { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
  );
  fireEvent.click(screen.getByRole('button', { name: /Cotton/ }));
  return { ...result, onSetBuildingProperty };
}

describe('SuppliesGroup Owner column', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows the connection creator, not the company name', () => {
    openGate(makeSupply({ connections: [conn({ createdBy: 'Vito', companyName: 'Vito Holdings' })] }));

    const cells = screen.getAllByRole('cell');
    const ownerCell = cells[2];
    expect(ownerCell.textContent).toBe('Vito');
    expect(cells.some((cell) => cell.textContent === 'Vito Holdings')).toBe(false);
  });

  it('keeps the company name reachable from the row title', () => {
    openGate(makeSupply({ connections: [conn({ createdBy: 'Vito', companyName: 'Vito Holdings' })] }));

    const row = document.querySelector('tbody tr');
    expect(row?.getAttribute('title')).toBe('Vito Holdings');
  });

  it('renders an empty cell when createdBy is empty, not the company name', () => {
    openGate(makeSupply({ connections: [conn({ createdBy: '', companyName: 'Vito Holdings' })] }));

    const cells = screen.getAllByRole('cell');
    const ownerCell = cells[2];
    expect(ownerCell.textContent).toBe('');
  });
});
