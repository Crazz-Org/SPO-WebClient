/**
 * ProfilePanel — own profile after a role switch.
 *
 * Switching to a role company ("Mayor of Helartia") makes the gateway speak as the
 * role (`switchCompany` in login-handler.ts), and the profile it serves carries the
 * role's name. The client derives the same name in `applyLocalCompanySwitch`, so the
 * "Change portrait" control stays on one's own profile under either name — the same
 * either-name, case-insensitive test the gateway's `resolveTycoon` applies.
 *
 * Real stores and the real `applyLocalCompanySwitch` — no mocks.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../__tests__/setup/render-helpers';
import { useGameStore } from '../../../store/game-store';
import { useProfileStore } from '../../../store/profile-store';
import { applyLocalCompanySwitch } from '../../../handlers/auth-handler';
import type { ClientHandlerContext } from '../../../handlers/client-context';
import { ProfilePanel } from '../ProfilePanel';
import type { TycoonProfileFull } from '@/shared/types';

function makeProfile(overrides: Partial<TycoonProfileFull> = {}): TycoonProfileFull {
  return {
    name: 'SPO_test3',
    realName: 'SPO_test3',
    ranking: 1,
    budget: '0',
    prestige: 0,
    facPrestige: 0,
    researchPrestige: 0,
    facCount: 0,
    facMax: 0,
    area: 0,
    nobPoints: 0,
    licenceLevel: 0,
    failureLevel: 0,
    levelName: 'Novice',
    levelTier: 0,
    ...overrides,
  };
}

const MAYOR = { id: '56', name: 'Mayor of Helartia', ownerRole: 'Mayor of Helartia' };
const PERSONAL = { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' };

function showProfile(name: string): void {
  act(() => {
    useProfileStore.getState().setProfile(makeProfile({ name }));
  });
  renderWithProviders(<ProfilePanel />);
}

describe('ProfilePanel — own profile after a role switch', () => {
  let ctx: ClientHandlerContext;

  beforeEach(() => {
    useGameStore.getState().reset();
    useProfileStore.getState().reset();
    useGameStore.getState().setCredentials('SPO_test3');
    ctx = { storedUsername: 'SPO_test3', currentCompanyName: '' } as unknown as ClientHandlerContext;
  });

  it('derives the role as the active username and offers the control on the role profile', () => {
    act(() => { applyLocalCompanySwitch(ctx, MAYOR); });

    expect(useGameStore.getState().activeUsername).toBe('Mayor of Helartia');
    showProfile('Mayor of Helartia');

    expect(screen.getByLabelText('Change portrait')).toBeTruthy();
  });

  it('still offers the control on the plain-name profile, case-insensitively', () => {
    act(() => { applyLocalCompanySwitch(ctx, MAYOR); });
    showProfile('spo_test3');

    expect(screen.getByLabelText('Change portrait')).toBeTruthy();
  });

  it('offers no control on another tycoon', () => {
    act(() => { applyLocalCompanySwitch(ctx, MAYOR); });
    showProfile('Crazz');

    expect(screen.queryByLabelText('Change portrait')).toBeNull();
  });

  it('drops the role name once switched back to a personal company', () => {
    act(() => { applyLocalCompanySwitch(ctx, MAYOR); });
    act(() => { applyLocalCompanySwitch(ctx, PERSONAL); });

    expect(useGameStore.getState().activeUsername).toBe('SPO_test3');
    showProfile('Mayor of Helartia');

    expect(screen.queryByLabelText('Change portrait')).toBeNull();
  });
});
