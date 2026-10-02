/**
 * InspectorV2 through the real building store: the states, the tabs, and the read pattern —
 * the same requests v1's BuildingInspector makes, and none for the synthetic Overview tab.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../store/building-store';
import { useGameStore } from '../../store/game-store';
import type { BuildingDetailsResponse, BuildingDetailsTab, BuildingFocusInfo } from '@/shared/types';
import type { DiagnosisAction } from '@/shared/building-details/facility-diagnosis';

jest.mock('../../components/building/DiagnosisBanner', () => ({
  ...jest.requireActual<typeof import('../../components/building/DiagnosisBanner')>('../../components/building/DiagnosisBanner'),
  DiagnosisBanner: ({ onAction, diagnosis }: { onAction: (a: DiagnosisAction) => void; diagnosis: { severity: string } }) => (
    <>
      <span>{`DIAG_SEVERITY:${diagnosis.severity}`}</span>
      <button type="button" onClick={() => onAction({ kind: 'openWorkforce' } as DiagnosisAction)}>DIAG_WORKFORCE</button>
      <button type="button" onClick={() => onAction({ kind: 'openResearch' } as DiagnosisAction)}>DIAG_RESEARCH</button>
    </>
  ),
}));

jest.mock('../../components/politics', () => ({
  ...jest.requireActual<typeof import('../../components/politics')>('../../components/politics'),
  OverviewSection: () => <div>CIVIC_OVERVIEW</div>,
  ElectionsSection: () => <div>CIVIC_ELECTIONS</div>,
}));

import { InspectorV2, AUTO_REFRESH_INTERVAL } from './InspectorV2';
import * as barrel from './index';

const focus: BuildingFocusInfo = {
  buildingId: 'bld-7', buildingName: 'Small Farm', ownerName: 'SPO_test3 - Green',
  salesInfo: 'Wheat sales at 80%', revenue: '$1,200/h',
  detailsText: 'Upgrade Level: 4  Producing: Wheat', hintsText: 'Needs workers',
  x: 150, y: 300, xsize: 3, ysize: 3, visualClass: '200',
};

const tabs: BuildingDetailsTab[] = [
  { id: 'indGeneral', name: 'General', order: 0, icon: 'G', handlerName: 'IndGeneral' },
  { id: 'workforce', name: 'Workforce', order: 1, icon: 'W', handlerName: 'Workforce' },
  { id: 'supplies', name: 'SUPPLIES', order: 2, icon: 'S', handlerName: 'Supplies', special: 'supplies' },
];

const details: BuildingDetailsResponse = {
  buildingId: 'bld-7', x: 150, y: 300, visualClass: '200', templateName: 'Farm',
  buildingName: 'Small Farm', ownerName: 'SPO_test3 - Green', securityId: 's', canGovern: false, tabs,
  groups: {
    indGeneral: [
      { name: 'Name', value: 'Small Farm' },
      { name: 'Creator', value: 'SPO_test3' },
      { name: 'ROI', value: '14%' },
      { name: 'Cost', value: '250000' },
    ],
  },
  timestamp: 1,
};

function show(over: Partial<BuildingDetailsResponse> = {}, currentTab = 'overview', f: BuildingFocusInfo = focus): void {
  useGameStore.setState({ status: 'connected' });
  useBuildingStore.getState().setFocus(f);
  useBuildingStore.getState().setDetails({ ...details, ...over });
  useBuildingStore.setState({ isLoading: false, currentTab });
}

function spied() {
  const onRequestTabData = jest.fn();
  const onRefreshBuilding = jest.fn();
  return { onRequestTabData, onRefreshBuilding, clientCallbacks: createSpiedCallbacks({ onRequestTabData, onRefreshBuilding }) };
}

describe('InspectorV2 — states', () => {
  beforeEach(resetStores);

  it('is the slot the side panel imports, from its file and the barrel', () => {
    expect(barrel.InspectorV2).toBe(InspectorV2);
  });

  it('asks for a building when nothing is focused', () => {
    renderWithProviders(<InspectorV2 />);
    expect(screen.getByText('Click a building on the map to inspect it')).toBeTruthy();
  });

  it('shows the focused name and owner while the details load, and asks for no section', () => {
    const s = spied();
    useGameStore.setState({ status: 'connected' });
    useBuildingStore.getState().setFocus(focus);
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    expect(screen.getByRole('heading', { name: 'Small Farm' })).toBeTruthy();
    expect(screen.getByText('SPO_test3 - Green')).toBeTruthy();
    expect(s.onRequestTabData).not.toHaveBeenCalled();
  });

  it('shows a load failure with a retry that re-reads the facility', () => {
    const s = spied();
    useBuildingStore.getState().setFocus(focus);
    useBuildingStore.getState().setDetailsError('The facility could not be read');
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });

    expect(screen.getByRole('alert').textContent).toContain('The facility could not be read');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(s.onRefreshBuilding).toHaveBeenCalledWith(150, 300, { userInitiated: true });
    expect(useBuildingStore.getState().detailsError).toBeNull();
  });
});

describe('InspectorV2 — standard facility', () => {
  beforeEach(resetStores);

  it('opens on Overview: hero, details and sales, and no section read', () => {
    const s = spied();
    show();
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });

    expect(screen.getByRole('heading', { name: 'Small Farm' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View on map' })).toBeTruthy();
    expect(s.onRequestTabData).not.toHaveBeenCalled();
  });

  it('reads a section when its tab opens, exactly as v1 names it', () => {
    const s = spied();
    show();
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });

    fireEvent.click(screen.getByRole('tab', { name: 'Workforce' }));
    expect(useBuildingStore.getState().currentTab).toBe('workforce');
    expect(s.onRequestTabData).toHaveBeenCalledTimes(1);
    expect(s.onRequestTabData).toHaveBeenCalledWith(150, 300, 'workforce', '200', ['workforce']);
  });

  it('reads a gate tab by id with no group list', () => {
    const s = spied();
    show({}, 'supplies');
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    expect(s.onRequestTabData).toHaveBeenCalledWith(150, 300, 'supplies', '200', undefined);
    expect(screen.getByRole('tabpanel').querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('opens a section it already holds without a read, and Overview again stores no section', () => {
    const s = spied();
    show();
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });

    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(s.onRequestTabData).not.toHaveBeenCalled();
    expect(screen.getByText('Value')).toBeTruthy();
    expect(screen.queryByText('Sales')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(useBuildingStore.getState().currentTab).toBe('');
    expect(s.onRequestTabData).not.toHaveBeenCalled();
  });

  it('opens a section from its Overview card', () => {
    show();
    renderWithProviders(<InspectorV2 />);
    fireEvent.click(screen.getByRole('button', { name: 'Workforce' }));
    expect(useBuildingStore.getState().currentTab).toBe('workforce');
  });

  it('offers a retry when a section read failed', () => {
    const s = spied();
    show({}, 'workforce');
    useBuildingStore.setState({ tabLoadingStates: { ...useBuildingStore.getState().tabLoadingStates, workforce: 'error' } });
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });

    expect(screen.getByText('This section could not be loaded.')).toBeTruthy();
    expect(s.onRequestTabData).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(s.onRefreshBuilding).toHaveBeenCalledWith(150, 300, { userInitiated: true });
  });

  it('switches to the tab a diagnosis action names, and ignores one with no tab', () => {
    show();
    renderWithProviders(<InspectorV2 />);
    fireEvent.click(screen.getByRole('button', { name: 'DIAG_RESEARCH' }));
    expect(useBuildingStore.getState().currentTab).toBe('overview');
    fireEvent.click(screen.getByRole('button', { name: 'DIAG_WORKFORCE' }));
    expect(useBuildingStore.getState().currentTab).toBe('workforce');
    expect(screen.getByRole('tab', { name: 'Workforce' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows a skeleton, not an empty section, while a section with no rows is owed its read', () => {
    const s = spied();
    show({}, 'workforce');
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    expect(screen.getByRole('tabpanel').querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(s.onRequestTabData).toHaveBeenCalledTimes(1);
    expect(s.onRequestTabData).toHaveBeenCalledWith(150, 300, 'workforce', '200', ['workforce']);
  });

  it('keeps the skeleton while the read is in flight, and draws the rows when they land', () => {
    show({}, 'workforce');
    useBuildingStore.getState().setTabLoading('workforce');
    renderWithProviders(<InspectorV2 />);
    expect(screen.getByRole('tabpanel').querySelector('[aria-busy="true"]')).toBeTruthy();

    act(() => {
      useBuildingStore.getState().mergeTabData('workforce', { groups: { workforce: [{ name: 'Workers', value: '12' }] } } as never, 150, 300);
    });
    expect(screen.getByRole('tabpanel').querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('drops a hint that sends the player to the inspector, keeps any other', () => {
    show({}, 'overview', { ...focus, hintsText: 'Hint: Go to INSPECT to carry out new researchs.' });
    const { unmount } = renderWithProviders(<InspectorV2 />);
    expect(screen.getByText('DIAG_SEVERITY:none')).toBeTruthy();
    unmount();

    show({}, 'overview', { ...focus, hintsText: 'Warning: Not enough company support.' });
    renderWithProviders(<InspectorV2 />);
    expect(screen.getByText('DIAG_SEVERITY:warning')).toBeTruthy();
  });

  it('reads nothing while disconnected', () => {
    const s = spied();
    show({}, 'workforce');
    useGameStore.setState({ status: 'reconnecting' });
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    expect(s.onRequestTabData).not.toHaveBeenCalled();
  });
});

describe('InspectorV2 — switching facilities', () => {
  beforeEach(resetStores);

  const college: BuildingFocusInfo = { ...focus, buildingName: 'College', ownerName: 'Yellow Inc. TEST', x: 10, y: 20 };

  it('never draws the previous facility under a new focus: loading state with the new name, no read', () => {
    const s = spied();
    show();
    useBuildingStore.getState().setFocus(college);
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });

    expect(screen.getByRole('heading', { name: 'College' })).toBeTruthy();
    expect(screen.getByText('Yellow Inc. TEST')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Small Farm' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(s.onRequestTabData).not.toHaveBeenCalled();
  });

  it('names nothing while a new facility is read and the store still holds the one being left', () => {
    show();
    useBuildingStore.getState().setLoading(true);
    renderWithProviders(<InspectorV2 />);
    expect(screen.getByRole('heading', { name: 'Loading facility…' })).toBeTruthy();
    expect(screen.queryByText('Small Farm')).toBeNull();
  });

  it('falls back to Overview, and reads nothing, when the open tab does not exist on this facility', () => {
    const s = spied();
    show({}, 'upgrade');
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(s.onRequestTabData).not.toHaveBeenCalled();
  });

  it('keeps the remembered section when the new facility has it (the store restores it on purpose)', () => {
    const s = spied();
    show();
    act(() => { useBuildingStore.getState().setCurrentTab('workforce'); });
    useBuildingStore.getState().setFocus(college);
    useBuildingStore.getState().setDetails({ ...details, x: 10, y: 20 });
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    expect(screen.getByRole('tab', { name: 'Workforce' }).getAttribute('aria-selected')).toBe('true');
    expect(s.onRequestTabData).toHaveBeenCalledWith(10, 20, 'workforce', '200', ['workforce']);
  });
});

describe('InspectorV2 — auto-refresh', () => {
  beforeEach(() => {
    resetStores();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('refreshes every 30 s, pauses while the tab is hidden, resumes when shown', () => {
    const s = spied();
    show();
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });

    act(() => { jest.advanceTimersByTime(AUTO_REFRESH_INTERVAL); });
    expect(s.onRefreshBuilding).toHaveBeenCalledWith(150, 300, { userInitiated: false });

    s.onRefreshBuilding.mockClear();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { jest.advanceTimersByTime(AUTO_REFRESH_INTERVAL * 2); });
    expect(s.onRefreshBuilding).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { jest.advanceTimersByTime(AUTO_REFRESH_INTERVAL); });
    expect(s.onRefreshBuilding).toHaveBeenCalledTimes(1);
  });

  it('stops on unmount and never runs while disconnected', () => {
    const s = spied();
    show();
    const { unmount } = renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    unmount();
    act(() => { jest.advanceTimersByTime(AUTO_REFRESH_INTERVAL); });
    expect(s.onRefreshBuilding).not.toHaveBeenCalled();

    useGameStore.setState({ status: 'reconnecting' });
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    act(() => { jest.advanceTimersByTime(AUTO_REFRESH_INTERVAL); });
    expect(s.onRefreshBuilding).not.toHaveBeenCalled();
  });
});

describe('InspectorV2 — civic building', () => {
  beforeEach(resetStores);

  const townHall: Partial<BuildingDetailsResponse> = {
    visualClass: '9999', buildingName: 'Helartia Town Hall',
    tabs: [
      { id: 'townGeneral', name: 'General', order: 0, icon: '', handlerName: 'townGeneral' },
      { id: 'votes', name: 'VOTES', order: 1, icon: '', handlerName: 'Votes' },
    ],
    groups: { townGeneral: [{ name: 'Town', value: 'Helartia' }] },
  };

  it('draws the civic tabs, reads the civic overview groups, and opens another civic tab', () => {
    const s = spied();
    show(townHall, 'overview', { ...focus, visualClass: '9999' });
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });

    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('CIVIC_OVERVIEW')).toBeTruthy();
    expect(screen.queryByText('DIAG_WORKFORCE')).toBeNull();
    expect(s.onRequestTabData).toHaveBeenCalledWith(150, 300, 'overview', '9999', ['townGeneral', 'votes']);

    fireEvent.click(screen.getByRole('tab', { name: 'Elections' }));
    expect(useBuildingStore.getState().currentTab).toBe('elections');
    expect(screen.getByText('CIVIC_ELECTIONS')).toBeTruthy();
  });

  it('falls back to the first civic tab when the stored one is not civic — and reads that one', () => {
    const s = spied();
    show(townHall, 'upgrade', { ...focus, visualClass: '9999' });
    renderWithProviders(<InspectorV2 />, { clientCallbacks: s.clientCallbacks });
    expect(screen.getByText('CIVIC_OVERVIEW')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(s.onRequestTabData).toHaveBeenCalledTimes(1);
    expect(s.onRequestTabData).toHaveBeenCalledWith(150, 300, 'overview', '9999', ['townGeneral', 'votes']);
  });
});
