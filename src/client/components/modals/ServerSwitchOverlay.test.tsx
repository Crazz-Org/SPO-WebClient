/**
 * ServerSwitchOverlay — rendering at the companies stage.
 *
 * Same minister rule as the login CompanyStage (chooseCompany.asp:23): a minister
 * switching servers is not offered company creation either.
 *
 * No company here means the visa page, exactly as on the sign-in screen: the journey is
 * the same one, only the entry point differs (maintainer decision, 2026-09-12). The
 * legacy branched the same way — ServerCnxHandler.pas:2796-2798 sets NEWACCOUNT when
 * GetCompanyCount = 0, and logonComplete.asp:168-181 routes that to chooseVisa.asp, whose
 * Tycoon Visa is how a first company gets created.
 */

import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useGameStore } from '../../store/game-store';
import { useUiStore } from '../../store/ui-store';
import { ServerSwitchOverlay } from './ServerSwitchOverlay';

describe('ServerSwitchOverlay — companies stage', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
    useUiStore.setState({
      rightPanel: null,
      leftPanel: null,
      modal: null,
      confirmPayload: null,
      commandPaletteOpen: false,
    });
  });

  it('offers the two visas to a non-minister account with no company', () => {
    useGameStore.getState().setWorld('Shamba');
    useGameStore.getState().setCredentials('SPO_test3');
    useGameStore.getState().enterServerSwitch();
    useGameStore.getState().setLoginCompanies([]);

    const { getByText } = renderWithProviders(<ServerSwitchOverlay />);
    expect(getByText('Tycoon Visa')).toBeTruthy();
    expect(getByText('Visitor Visa')).toBeTruthy();
  });

  it('withholds company creation from a minister account', () => {
    useGameStore.getState().setWorld('Shamba');
    useGameStore.getState().setCredentials('Minister of Health');
    useGameStore.getState().enterServerSwitch();
    useGameStore.getState().setLoginCompanies([]);

    const { queryByText } = renderWithProviders(<ServerSwitchOverlay />);
    expect(queryByText('Create New Company')).toBeNull();
  });
});
