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
import { CompanyStage, companySealUrl } from './CompanyStage';
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
});

// ---------------------------------------------------------------------------
// CompanyStage
// ---------------------------------------------------------------------------

describe('CompanyStage', () => {
  const companies: CompanyInfo[] = [
    { id: '1', name: 'TestCo', ownerRole: 'Owner', value: 500000, cluster: 'PGI', facilityCount: 12 },
    { id: '2', name: 'Shamba Gov', ownerRole: 'President of Shamba', value: 0, cluster: 'Moab', facilityCount: 1 },
  ];

  const defaultProps = {
    companies,
    worldName: 'Shamba',
    username: 'Owner',
    worldIp: '1.2.3.4',
    onSelect: () => {},
    onCreate: () => {},
    onBack: () => {},
    isLoading: false,
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

  it('renders back button', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('Back to worlds')).toBeTruthy();
  });

  // chooseCompany.asp:193-197 — the owner role is shown, unless it IS the
  // logged-in account, in which case the page prints strPrivate.
  it('reads "Private" for the card whose owner role is the logged-in account', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.queryByText('Owner')).toBeNull();
  });

  it('keeps the role itself on a card owned by someone else', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('President of Shamba')).toBeTruthy();
  });

  it('shows the facility count, singular for one', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    expect(screen.getByText('12 facilities')).toBeTruthy();
    expect(screen.getByText('1 facility')).toBeTruthy();
  });

  it('shows the cluster seal the world serves', () => {
    renderWithProviders(<CompanyStage {...defaultProps} />);
    const seal = screen.getByAltText('PGI') as HTMLImageElement;
    expect(seal.src).toBe('http://1.2.3.4/Five/0/Visual/Voyager/NewLogon/images/comp-pgi.gif');
  });

  it('falls back to a text medallion when the company has no cluster', () => {
    const noCluster: CompanyInfo[] = [{ id: '3', name: 'Clusterless', ownerRole: 'Owner' }];
    renderWithProviders(<CompanyStage {...defaultProps} companies={noCluster} />);
    expect(screen.queryByAltText('PGI')).toBeNull();
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('falls back to the cluster name when the world address is unknown', () => {
    renderWithProviders(<CompanyStage {...defaultProps} worldIp={undefined} />);
    expect(screen.queryByAltText('PGI')).toBeNull();
    expect(screen.getByText('PGI')).toBeTruthy();
  });

  it('omits the facility line for a company whose count is unknown', () => {
    const unknown: CompanyInfo[] = [{ id: '4', name: 'Unknown Co', ownerRole: 'Owner', cluster: 'PGI' }];
    renderWithProviders(<CompanyStage {...defaultProps} companies={unknown} />);
    expect(screen.queryByText(/facilit/)).toBeNull();
  });

  it('builds the seal URL the page itself loads', () => {
    expect(companySealUrl('5.6.7.8', 'Mariko'))
      .toBe('http://5.6.7.8/Five/0/Visual/Voyager/NewLogon/images/comp-mariko.gif');
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
