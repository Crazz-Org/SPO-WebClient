/**
 * A hideEmpty row is dropped only when the cache has nothing (absent / '' /
 * whitespace). A real '0' is printed — except for the few members Voyager
 * reads as "none" at 0 (HIDDEN_AT_ZERO_NAMES in PropertyGroup.tsx).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup, isHiddenEmpty } from '../PropertyGroup';
import { RES_GENERAL_GROUP, SRV_GENERAL_GROUP } from '@/shared/building-details/template-groups';
import type { BuildingPropertyValue, BuildingDetailsResponse } from '@/shared/types';

function seed(visualClass: string, tabId: string, handlerName: string): void {
  const details: BuildingDetailsResponse = {
    buildingId: `bld-${visualClass}`,
    x: 100, y: 200,
    visualClass,
    templateName: 'Generic',
    buildingName: 'Test',
    ownerName: 'TestCo',
    securityId: 'sec-1',
    canGovern: false,
    tabs: [{ id: tabId, name: tabId.toUpperCase(), order: 0, icon: 'G', handlerName }],
    groups: { [tabId]: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ isLoading: false, currentTab: tabId, isOwner: true });
}

function renderProps(props: BuildingPropertyValue[]) {
  return renderWithProviders(<PropertyGroup properties={props} buildingX={100} buildingY={200} />);
}

function def(group: typeof RES_GENERAL_GROUP, name: string) {
  const d = group.properties.find(p => p.rdoName === name);
  if (!d) throw new Error(`no ${name}`);
  return d;
}

describe('ResGeneral — non-exempt ActualCrime', () => {
  beforeEach(() => {
    resetStores();
    seed('90001', 'resGeneral', 'ResGeneral');
  });

  it("'0' renders the row as 0%", () => {
    renderProps([{ name: 'Name', value: 'Block' }, { name: 'ActualCrime', value: '0' }]);
    const label = screen.getByText('Effective Crime');
    expect(label.parentElement!.textContent).toContain('0%');
  });

  it("'' hides the row and no raw fallback row appears", () => {
    const { container } = renderProps([{ name: 'Name', value: 'Block' }, { name: 'ActualCrime', value: '' }]);
    expect(screen.queryByText('Effective Crime')).toBeNull();
    expect(container.textContent).not.toContain('ActualCrime');
  });

  it('absent hides the row', () => {
    renderProps([{ name: 'Name', value: 'Block' }]);
    expect(screen.queryByText('Effective Crime')).toBeNull();
  });

  it('whitespace is hidden; a def without hideEmpty never is', () => {
    expect(isHiddenEmpty(def(RES_GENERAL_GROUP, 'ActualCrime'), '   ')).toBe(true);
    expect(isHiddenEmpty({ rdoName: 'X', displayName: 'X', type: RES_GENERAL_GROUP.properties[0].type }, '')).toBe(false);
  });
});

describe('SrvGeneral — exempt Trouble', () => {
  beforeEach(() => {
    resetStores();
    seed('90002', 'srvGeneral', 'SrvGeneral');
  });

  it("'0' is hidden when rendered", () => {
    const { container } = renderProps([{ name: 'Name', value: 'Shop' }, { name: 'Trouble', value: '0' }]);
    expect(container.textContent).not.toContain('Issues');
    expect(container.textContent).not.toContain('Trouble');
  });

  it("'32' is not dropped by the empty filter", () => {
    // The rendered Trouble row never shows whatever its value: Trouble is on
    // HIDDEN_PROPERTY_NAMES, a separate rule. So the "shown" half is asserted
    // against the real exported filter the component calls.
    const troubleDef = def(SRV_GENERAL_GROUP, 'Trouble');
    expect(isHiddenEmpty(troubleDef, '32')).toBe(false);
    expect(isHiddenEmpty(troubleDef, '0')).toBe(true);
  });

  it('SecurityId never prints; empty SecurityId is dropped by the filter', () => {
    const { container } = renderProps([{ name: 'Name', value: 'Shop' }, { name: 'SecurityId', value: '-132445236-' }]);
    expect(container.textContent).not.toContain('-132445236-');
    expect(isHiddenEmpty(def(SRV_GENERAL_GROUP, 'SecurityId'), '')).toBe(true);
  });
});

describe('Upgrade — exempt NextUpgCost, rendered', () => {
  function upgradeProps(cost: string): BuildingPropertyValue[] {
    return [
      { name: 'UpgradeLevel', value: '3' },
      { name: 'MaxUpgrade', value: '10' },
      { name: 'NextUpgCost', value: cost },
      { name: 'Upgrading', value: '0' },
      { name: 'Pending', value: '0' },
      { name: 'UpgradeActions', value: '' },
    ];
  }

  beforeEach(() => {
    resetStores();
    seed('90003', 'upgrade', 'facManagement');
  });

  it("'0' hides Upgrade Cost", () => {
    renderProps(upgradeProps('0'));
    expect(screen.queryByText('Upgrade Cost')).toBeNull();
  });

  it("'50000' shows Upgrade Cost", () => {
    renderProps(upgradeProps('50000'));
    expect(screen.getByText('Upgrade Cost')).toBeTruthy();
  });
});
