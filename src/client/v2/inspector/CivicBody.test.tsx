import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { BuildingDetailsResponse } from '@/shared/types';

type Rec = Record<string, unknown>;
const show = (name: string) => (props: Rec) => <div data-testid={name}>{JSON.stringify(props)}</div>;

jest.mock('../../components/politics', () => ({
  OverviewSection: show('overview'),
  AdministrationSection: show('administration'),
  DemographicsSection: show('demographics'),
  ElectionsSection: show('elections'),
  PoliticsSection: show('politics'),
  getGeneralGroupId: (tabs: Array<{ id: string }>) => (tabs.some((t) => t.id === 'townGeneral') ? 'townGeneral' : undefined),
}));

import { CivicBody } from './CivicBody';

const p = (name: string) => [{ name, value: '1' }];

const details = {
  buildingId: 'th', x: 10, y: 20, visualClass: '9999', templateName: 'TH', buildingName: 'Town Hall',
  ownerName: 'X', securityId: '', canGovern: true, timestamp: 0,
  tabs: [{ id: 'townGeneral', name: 'GENERAL', order: 0, icon: '', handlerName: 'TownGeneral' }],
  groups: {
    townGeneral: p('Town'), votes: p('RulerName'), capitolTowns: p('T'), ministeries: p('M'),
    townTaxes: p('Tax'), townJobs: p('J'), townRes: p('R'), townServices: p('S'),
  },
} as unknown as BuildingDetailsResponse;

function props(id: string): Rec {
  return JSON.parse(screen.getByTestId(id).textContent ?? '{}') as Rec;
}

describe('CivicBody', () => {
  it('hands Overview the general and votes groups', () => {
    render(<CivicBody activeTab="overview" details={details} canGovern demographics={null} />);
    expect(props('overview')).toMatchObject({ generalProperties: p('Town'), votesProperties: p('RulerName'), buildingX: 10, buildingY: 20 });
  });

  it('hands Administration the towns, ministries and taxes, and the governing flag', () => {
    render(<CivicBody activeTab="administration" details={details} canGovern demographics={null} />);
    expect(props('administration')).toMatchObject({ townsProperties: p('T'), ministriesProperties: p('M'), taxesProperties: p('Tax'), canGovern: true });
  });

  it('hands Demographics the jobs, residentials, services and the demographics', () => {
    const demographics = { total: 5 } as never;
    render(<CivicBody activeTab="demographics" details={details} canGovern={false} demographics={demographics} />);
    expect(props('demographics')).toMatchObject({ jobsProperties: p('J'), residentialsProperties: p('R'), servicesProperties: p('S'), demographics: { total: 5 }, canGovern: false });
  });

  it('routes Elections and Politics', () => {
    const { unmount } = render(<CivicBody activeTab="elections" details={details} canGovern demographics={null} />);
    expect(props('elections')).toMatchObject({ votesProperties: p('RulerName') });
    unmount();
    render(<CivicBody activeTab="politics" details={details} canGovern demographics={null} />);
    expect(props('politics')).toEqual({ buildingX: 10, buildingY: 20 });
  });

  it('draws nothing for an unknown tab, and survives missing groups', () => {
    const bare = { ...details, tabs: [], groups: {} } as unknown as BuildingDetailsResponse;
    const { container } = render(<CivicBody activeTab="nope" details={bare} canGovern demographics={null} />);
    expect(container.innerHTML).toBe('');
    render(<CivicBody activeTab="overview" details={bare} canGovern demographics={null} />);
    expect(props('overview')).toMatchObject({ generalProperties: [], votesProperties: [] });
  });
});
