/**
 * ServerSwitchOverlay — rendering at the companies stage.
 *
 * Same minister rule as the login CompanyStage (chooseCompany.asp:23): a minister
 * switching servers is not offered company creation either.
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

  it('offers company creation to a non-minister account', () => {
    useGameStore.getState().setWorld('Shamba');
    useGameStore.getState().setCredentials('SPO_test3');
    useGameStore.getState().enterServerSwitch();
    useGameStore.getState().setLoginCompanies([]);

    const { getByText } = renderWithProviders(<ServerSwitchOverlay />);
    expect(getByText('Create New Company')).toBeTruthy();
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
