/**
 * ProfilePanel — Companies tab withholds company creation from a minister account.
 *
 * chooseCompany.asp:23 — `InStr(UCASE(UserName), "MINISTER OF ") = 1`.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useProfileStore } from '../../../store/profile-store';
import { useGameStore } from '../../../store/game-store';
import { ProfilePanel } from '../ProfilePanel';

function clickSection(label: string): void {
  fireEvent.click(within(screen.getByLabelText('Profile sections')).getByText(label));
}

function openCompanies() {
  clickSection('Companies');
  act(() => {
    useProfileStore.getState().setCompanies({
      companies: [
        { name: 'Green Co', companyId: 7, ownerRole: 'Tycoon', cluster: 'A', facilityCount: 3, companyType: 'Industry' },
      ],
      currentCompany: 'Green Co',
      worldName: 'planitia',
    });
  });
}

describe('ProfilePanel — Companies tab, minister accounts', () => {
  beforeEach(() => {
    useProfileStore.getState().reset();
    useGameStore.getState().setCredentials('');
  });

  it('offers company creation to a non-minister account', () => {
    const onCreateCompany = jest.fn();
    useGameStore.getState().setCredentials('SPO_test3');
    renderWithProviders(<ProfilePanel />, {
      clientCallbacks: createSpiedCallbacks({ onCreateCompany }),
    });
    openCompanies();

    const button = screen.getByText('Create New Company');
    fireEvent.click(button);
    expect(onCreateCompany).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/create a new one/)).toBeTruthy();
  });

  it('withholds company creation from a minister account', () => {
    useGameStore.getState().setCredentials('Minister of Health');
    renderWithProviders(<ProfilePanel />);
    openCompanies();

    expect(screen.queryByText('Create New Company')).toBeNull();
    expect(screen.getByText('Green Co')).toBeTruthy();
    expect(screen.queryByText(/create a new one/)).toBeNull();
  });
});
