/**
 * Smoke tests for login stage components.
 */

import { describe, it, expect } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { AuthStage } from './AuthStage';
import { AuthErrorModal } from './AuthErrorModal';
import { WorldStage } from './WorldStage';
import { ZoneStage } from './ZoneStage';
import { CompanyStage } from './CompanyStage';
import type { WorldInfo, CompanyInfo } from '@/shared/types';

// ---------------------------------------------------------------------------
// AuthStage
// ---------------------------------------------------------------------------

describe('AuthStage', () => {
  const defaultProps = {
    onConnect: () => {},
    isLoading: false,
    status: 'idle',
  };

  it('renders login form', () => {
    renderWithProviders(<AuthStage {...defaultProps} />);
    expect(screen.getByPlaceholderText('Username')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
    expect(screen.getByText('Enter the World')).toBeTruthy();
  });

  it('renders loading state', () => {
    renderWithProviders(<AuthStage {...defaultProps} isLoading />);
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('shows logo and tagline', () => {
    renderWithProviders(<AuthStage {...defaultProps} />);
    expect(screen.getByText('STARPEACE ONLINE')).toBeTruthy();
    expect(screen.getByText('Build your empire. Shape the world.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ZoneStage
// ---------------------------------------------------------------------------

describe('ZoneStage', () => {
  it('renders zone selection title', () => {
    renderWithProviders(<ZoneStage onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText('Select a Region')).toBeTruthy();
  });

  it('renders zone cards', () => {
    renderWithProviders(<ZoneStage onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText('BETA')).toBeTruthy();
  });

  it('shows a deadline gauge while loading', () => {
    const { unmount } = renderWithProviders(<ZoneStage onSelect={() => {}} isLoading />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    unmount();
  });
});

// ---------------------------------------------------------------------------
// WorldStage
// ---------------------------------------------------------------------------

describe('WorldStage', () => {
  const worlds: WorldInfo[] = [
    { name: 'Shamba', url: '', ip: '127.0.0.1', port: 1234, running3: true, online: 12, players: 12, population: 5000 },
    { name: 'Offline World', url: '', ip: '127.0.0.1', port: 1234, running3: false, online: 0, players: 0, population: 0 },
  ];

  it('renders world selection title', () => {
    renderWithProviders(<WorldStage worlds={worlds} onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText('Select a World')).toBeTruthy();
  });

  it('renders available worlds', () => {
    renderWithProviders(<WorldStage worlds={worlds} onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText('Shamba')).toBeTruthy();
  });

  it('renders offline worlds', () => {
    renderWithProviders(<WorldStage worlds={worlds} onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText('Offline World')).toBeTruthy();
  });

  // RDOCanJoinNewWorld (DServer/DirectoryServer.pas:116) answered 0 — the player is told
  // before picking a world, which is the whole point of asking during connectDirectory.
  it('warns about the world limit when the directory refused another world', () => {
    renderWithProviders(
      <WorldStage worlds={worlds} onSelect={() => {}} isLoading={false} atWorldLimit />,
    );
    expect(screen.getByText(/reached the number of worlds your nobility allows/)).toBeTruthy();
  });

  it('says nothing about a limit when the directory did not refuse', () => {
    renderWithProviders(<WorldStage worlds={worlds} onSelect={() => {}} isLoading={false} />);
    expect(screen.queryByText(/reached the number of worlds your nobility allows/)).toBeNull();
  });

  // General/Date comes back from the directory as a bare year (login-handler.ts:1001).
  it('shows the in-game year on an online world that carries a date', () => {
    const dated: WorldInfo[] = [
      { name: 'Dated', url: '', ip: '127.0.0.1', port: 1234, running3: true, online: 1, players: 1, population: 10, date: '2232' },
    ];
    renderWithProviders(<WorldStage worlds={dated} onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText('Year')).toBeTruthy();
    expect(screen.getByText('2232')).toBeTruthy();
  });

  it('shows no year tile on an online world whose record has no date', () => {
    const undated: WorldInfo[] = [worlds[0]];
    renderWithProviders(<WorldStage worlds={undated} onSelect={() => {}} isLoading={false} />);
    expect(screen.queryByText('Year')).toBeNull();
  });

  it('leaves an offline card unchanged even when its record carries a date', () => {
    const offlineDated: WorldInfo[] = [
      { name: 'Offline Dated', url: '', ip: '127.0.0.1', port: 1234, running3: false, online: 0, players: 0, population: 0, date: '2232' },
    ];
    renderWithProviders(<WorldStage worlds={offlineDated} onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText('Server unavailable')).toBeTruthy();
    expect(screen.queryByText('Year')).toBeNull();
    expect(screen.queryByText('2232')).toBeNull();
  });

  it('shows the servers-down message and a retry control when no world came back', () => {
    const onRetry = jest.fn();
    renderWithProviders(<WorldStage worlds={[]} onSelect={() => {}} onRetry={onRetry} isLoading={false} />);
    expect(screen.getByText(/servers are down/i)).toBeTruthy();
    const retryButton = screen.getByRole('button', { name: 'Retry' });
    expect(retryButton).toBeTruthy();
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show the servers-down message when a world is listed', () => {
    const onRetry = jest.fn();
    renderWithProviders(<WorldStage worlds={[worlds[0]]} onSelect={() => {}} onRetry={onRetry} isLoading={false} />);
    expect(screen.queryByText(/servers are down/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('hides the retry control when no retry handler is given', () => {
    renderWithProviders(<WorldStage worlds={[]} onSelect={() => {}} isLoading={false} />);
    expect(screen.getByText(/servers are down/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows a deadline gauge while loading', () => {
    const { unmount } = renderWithProviders(<WorldStage worlds={worlds} onSelect={() => {}} isLoading />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    unmount();
  });
});

// ---------------------------------------------------------------------------
// CompanyStage
// ---------------------------------------------------------------------------

describe('CompanyStage', () => {
  const companies: CompanyInfo[] = [
    { id: '1', name: 'TestCo', ownerRole: 'Owner', value: 500000 },
    { id: '2', name: 'Shamba Gov', ownerRole: 'President of Shamba', value: 0 },
  ];

  const defaultProps = {
    companies,
    worldName: 'Shamba',
    onSelect: () => {},
    onCreate: () => {},
    onBack: () => {},
    isLoading: false,
    username: 'SPO_test3',
  };

  it('renders company selection title', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('Select a Company')).toBeTruthy();
    expect(screen.getByText('Shamba')).toBeTruthy();
  });

  it('separates owned and political companies', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('Your Companies')).toBeTruthy();
    expect(screen.getByText('Political Offices')).toBeTruthy();
  });

  it('renders company names', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('TestCo')).toBeTruthy();
    expect(screen.getByText('Shamba Gov')).toBeTruthy();
  });

  it('renders create new company card', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('Create New Company')).toBeTruthy();
  });

  it('calls onCreate when the create card is clicked', () => {
    const onCreate = jest.fn();
    renderWithProviders(<CompanyStage {...defaultProps} onCreate={onCreate} />);
    fireEvent.click(screen.getByText('Create New Company'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('renders back button', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('Back to worlds')).toBeTruthy();
  });

  it('renders a denial with the expiry date and no "Create New Company" card', () => {
    renderWithProviders(
      <CompanyStage {...defaultProps} loginPage={{ kind: 'denied', expiresOn: '01/01/2020' }} />,
    );
    expect(screen.getByText('Access Denied')).toBeTruthy();
    expect(screen.getByText(/expired on 01\/01\/2020/)).toBeTruthy();
    expect(screen.queryByText('Create New Company')).toBeNull();
  });

  it('renders the travel-pass sentence for the 01/01/2008 sentinel', () => {
    renderWithProviders(
      <CompanyStage {...defaultProps} loginPage={{ kind: 'denied', expiresOn: '01/01/2008' }} />,
    );
    expect(screen.getByText(/special travel pass/)).toBeTruthy();
  });

  it('renders the error code for a logonError.asp outcome', () => {
    renderWithProviders(
      <CompanyStage {...defaultProps} loginPage={{ kind: 'error', errorCode: 'ERROR_FIVEISDOWN' }} />,
    );
    expect(screen.getByText(/ERROR_FIVEISDOWN/)).toBeTruthy();
    expect(screen.queryByText('Create New Company')).toBeNull();
  });

  it('shows the welcome message when companies is empty and no loginPage is set', () => {
    renderWithProviders(<CompanyStage {...defaultProps} companies={[]} />);
    expect(screen.getByText(/Create your first company/)).toBeTruthy();
  });

  // CanJoinWorldEx (Interface Server/InterfaceServer.pas:441) — the world already said
  // NewCompany would fail, so the card that produced "error code 7" is not offered.
  it('says the world is full and offers the other worlds instead of company creation', () => {
    renderWithProviders(
      <CompanyStage {...defaultProps} companies={[]} admission={{ kind: 'full' }} />,
    );
    expect(screen.getByText('World Full')).toBeTruthy();
    expect(screen.getByText(/Shamba has reached its maximum number of tycoons/)).toBeTruthy();
    expect(screen.queryByText('Create New Company')).toBeNull();
    expect(screen.queryByText(/Create your first company/)).toBeNull();
    expect(screen.getByText('Choose another world')).toBeTruthy();
  });

  it('sends the player back to the world list from the full-world message', () => {
    const onBack = jest.fn();
    renderWithProviders(
      <CompanyStage {...defaultProps} companies={[]} admission={{ kind: 'full' }} onBack={onBack} />,
    );
    fireEvent.click(screen.getByText('Choose another world'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('states the nobility shortfall in points', () => {
    renderWithProviders(
      <CompanyStage {...defaultProps} companies={[]} admission={{ kind: 'nobility', shortfall: 3 }} />,
    );
    expect(screen.getByText('Nobility Too Low')).toBeTruthy();
    expect(screen.getByText(/3 point\(s\) below/)).toBeTruthy();
    expect(screen.queryByText('Create New Company')).toBeNull();
  });

  it('keeps existing companies in a full world, minus the creation card', () => {
    renderWithProviders(<CompanyStage {...defaultProps} admission={{ kind: 'full' }} />);
    expect(screen.getByText('Select a Company')).toBeTruthy();
    expect(screen.getByText('TestCo')).toBeTruthy();
    expect(screen.queryByText('Create New Company')).toBeNull();
  });

  // RDOCanJoinNewWorld (DServer/DirectoryServer.pas:116) answered 0 and the player holds
  // nothing here — chooseVisa.asp withheld the Tycoon visa but kept the Visitor one.
  it('withholds company creation and offers the visitor entry at the world limit', () => {
    renderWithProviders(<CompanyStage {...defaultProps} companies={[]} atWorldLimit />);
    expect(screen.getByText('World Limit Reached')).toBeTruthy();
    expect(screen.getByText(/no company can be founded in Shamba/)).toBeTruthy();
    expect(screen.getByText('Enter as a visitor')).toBeTruthy();
    expect(screen.getByText('Choose another world')).toBeTruthy();
    expect(screen.queryByText('Create New Company')).toBeNull();
    expect(screen.queryByText(/Create your first company/)).toBeNull();
  });

  it.each(['Mayor of Helartia', 'President of Shamba'])(
    'offers company creation to a %s',
    (username) => {
      renderWithProviders(<CompanyStage {...defaultProps} username={username} />);
      expect(screen.getByText('Create New Company')).toBeTruthy();
    },
  );

  // chooseCompany.asp:23 — `InStr(UCASE(UserName), "MINISTER OF ") = 1`.
  it('withholds company creation from a minister account', () => {
    renderWithProviders(
      <CompanyStage {...defaultProps} username="Minister of Health" companies={[]} />,
    );
    expect(screen.queryByText('Create New Company')).toBeNull();
    expect(screen.queryByText(/Create your first company/)).toBeNull();
  });

  it('enters as a visitor when that card is clicked', () => {
    const onVisit = jest.fn();
    renderWithProviders(
      <CompanyStage {...defaultProps} companies={[]} atWorldLimit onVisit={onVisit} />,
    );
    fireEvent.click(screen.getByText('Enter as a visitor'));
    expect(onVisit).toHaveBeenCalledTimes(1);
  });

  it('sends the player back to the world list from the world-limit message', () => {
    const onBack = jest.fn();
    renderWithProviders(
      <CompanyStage {...defaultProps} companies={[]} atWorldLimit onBack={onBack} />,
    );
    fireEvent.click(screen.getByText('Choose another world'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the visitor card is clicked while loading', () => {
    const onVisit = jest.fn();
    renderWithProviders(
      <CompanyStage {...defaultProps} companies={[]} atWorldLimit onVisit={onVisit} isLoading />,
    );
    fireEvent.click(screen.getByText('Enter as a visitor'));
    expect(onVisit).not.toHaveBeenCalled();
  });

  // logonComplete.asp:106 vs :144 — the reference client never asked CanJoinWorldEx after a
  // false RDOCanJoinNewWorld, so the world-limit block wins and the admission one is not shown.
  it('takes precedence over the world admission answer', () => {
    renderWithProviders(
      <CompanyStage {...defaultProps} companies={[]} atWorldLimit admission={{ kind: 'full' }} />,
    );
    expect(screen.getByText('World Limit Reached')).toBeTruthy();
    expect(screen.queryByText('World Full')).toBeNull();
    expect(screen.queryByText(/Shamba has reached its maximum number of tycoons/)).toBeNull();
  });

  // Kernel/World.pas:6028 guards the whole check on Companies.Count = 0.
  it('changes nothing in a world where the player already owns a company', () => {
    renderWithProviders(<CompanyStage {...defaultProps} atWorldLimit />);
    expect(screen.getByText('Select a Company')).toBeTruthy();
    expect(screen.getByText('TestCo')).toBeTruthy();
    expect(screen.getByText('Create New Company')).toBeTruthy();
    expect(screen.queryByText('World Limit Reached')).toBeNull();
    expect(screen.queryByText('Enter as a visitor')).toBeNull();
  });

  it('withholds company creation from a minister account case-insensitively', () => {
    renderWithProviders(<CompanyStage {...defaultProps} username="minister of health" />);
    expect(screen.queryByText('Create New Company')).toBeNull();
    expect(screen.getByText('TestCo')).toBeTruthy();
  });

  it('shows a deadline gauge while loading', () => {
    const { unmount } = renderWithProviders(<CompanyStage {...defaultProps} isLoading />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    unmount();
  });
});

// ---------------------------------------------------------------------------
// AuthErrorModal
// ---------------------------------------------------------------------------

describe('AuthErrorModal', () => {
  const defaultError = { code: 13, message: 'Invalid password' };

  it('renders error message and title', () => {
    renderWithProviders(<AuthErrorModal error={defaultError} onDismiss={() => {}} />);
    expect(screen.getByText('Authentication Failed')).toBeTruthy();
    expect(screen.getByText('Invalid password')).toBeTruthy();
  });

  it('renders error code when code > 0', () => {
    renderWithProviders(<AuthErrorModal error={defaultError} onDismiss={() => {}} />);
    expect(screen.getByText('Error code: 13')).toBeTruthy();
  });

  it('hides error code when code is 0', () => {
    renderWithProviders(<AuthErrorModal error={{ code: 0, message: 'Unknown error' }} onDismiss={() => {}} />);
    expect(screen.queryByText(/Error code/)).toBeNull();
  });

  it('calls onDismiss when Try Again is clicked', () => {
    const onDismiss = jest.fn();
    renderWithProviders(<AuthErrorModal error={defaultError} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Try Again'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss on Escape key', () => {
    const onDismiss = jest.fn();
    renderWithProviders(<AuthErrorModal error={defaultError} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders Try Again button', () => {
    renderWithProviders(<AuthErrorModal error={defaultError} onDismiss={() => {}} />);
    expect(screen.getByText('Try Again')).toBeTruthy();
  });
});
