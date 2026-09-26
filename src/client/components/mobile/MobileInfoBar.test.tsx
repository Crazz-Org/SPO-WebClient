import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { MobileInfoBar } from './MobileInfoBar';

describe('MobileInfoBar', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.getState().setMobileTab('build');
    useGameStore.setState({ isVisitor: false, worldName: 'planitia', username: 'SPO_test3', tycoonStats: { cash: '1000', incomePerHour: '10', ranking: 3, buildingCount: 1, maxBuildings: 9 } as never });
  });

  it('a tap opens the Profile surface in the sheet (the former Fav tab is gone)', () => {
    renderWithProviders(<MobileInfoBar />);
    // Two tap zones (main + identity) share the label — both open the Profile
    fireEvent.click(screen.getAllByRole('button', { name: 'Open empire overview' })[0]);
    expect(useUiStore.getState().mobileTab).toBe('map');
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['empire']);
  });

  it('shows no Debt tag while the tycoon is healthy', () => {
    renderWithProviders(<MobileInfoBar />);
    expect(screen.queryByText('Debt')).toBeNull();
  });

  it('in debt, the tag appears and taps through to the facilities list (H6)', () => {
    useGameStore.setState({
      tycoonStats: { cash: '1000', incomePerHour: '10', ranking: 3, buildingCount: 1, maxBuildings: 9, failureLevel: 1 } as never,
    });
    renderWithProviders(<MobileInfoBar />);
    fireEvent.click(screen.getByRole('button', { name: 'View facilities losing money' }));
    expect(useUiStore.getState().mobileTab).toBe('map');
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['facilities']);
  });

  it('a visitor is offered no gated panel: no empire tap, no Debt tag', () => {
    useGameStore.setState({
      isVisitor: true,
      tycoonStats: { cash: '1000', incomePerHour: '10', ranking: 3, buildingCount: 1, maxBuildings: 9, failureLevel: 1 } as never,
    });
    renderWithProviders(<MobileInfoBar />);
    expect(screen.queryByRole('button', { name: 'Open empire overview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View facilities losing money' })).toBeNull();
    expect(screen.getByText('PLANITIA')).toBeTruthy();
    expect(screen.getByText(/#3 SPO_test3/)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(useUiStore.getState().stack).toEqual([]);
  });
});
