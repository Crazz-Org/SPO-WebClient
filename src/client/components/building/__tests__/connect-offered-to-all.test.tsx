/**
 * `Connect` is offered on the General tab to every player, not just the owner
 * (issue 561). Voyager enables `btnConnect` unconditionally
 * (SrvGeneralSheetForm.pas:190, TVGeneralSheet.pas:133) while `btnDemolish`
 * stays gated on `fOwnsFacility` (IndustryGeneralSheet.pas:167) — the server
 * is the one that authorises the connection (Kernel/World.pas:3717-3724).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import type { BuildingPropertyValue, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

const X = 118;
const Y = 226;
/** Its own visual class: `registerInspectorTabs` caches per class. */
const CLASS = '561';

const TABS: BuildingDetailsTab[] = [
  { id: 'srvGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'SrvGeneral' },
];

const PROPS: BuildingPropertyValue[] = [
  { name: 'Creator', value: 'Bob' },
] as BuildingPropertyValue[];

function seed(isOwner: boolean): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-561',
    x: X, y: Y,
    visualClass: CLASS,
    templateName: 'Drug Store',
    buildingName: 'Drug Store 10',
    ownerName: 'Yellow Inc.',
    securityId: 'sec-1',
    canGovern: false,
    tabs: TABS,
    groups: { srvGeneral: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ isLoading: false, currentTab: 'srvGeneral', isOwner });
}

describe('Connect is offered to every player', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows Connect but not Demolish to a non-owner, and Connect dispatches connectMap', () => {
    const onBuildingAction = jest.fn();
    seed(false);
    renderWithProviders(
      <PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />,
      { clientCallbacks: createSpiedCallbacks({ onBuildingAction }) },
    );

    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Demolish' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onBuildingAction).toHaveBeenCalledWith('connectMap');
  });

  it('shows both Connect and Demolish to the owner', () => {
    seed(true);
    renderWithProviders(<PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />);

    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Demolish' })).toBeTruthy();
  });
});
