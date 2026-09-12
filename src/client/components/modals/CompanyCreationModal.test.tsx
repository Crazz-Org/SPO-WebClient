/**
 * CompanyCreationModal — the client-side name guard.
 *
 * The modal refuses exactly what the server's ValidName refuses
 * (Cache/CacheCommon.pas:110-125) and nothing more: a name carrying '&' or '+' is
 * sent, a name carrying '{', '}', '%' or '..' is refused with its reason before
 * any round-trip.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import {
  renderWithProviders,
  resetStores,
  createSpiedCallbacks,
} from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { CompanyCreationModal } from './CompanyCreationModal';

function open(): void {
  useGameStore.setState({ companyCreationClusters: ['PGI'] });
  useUiStore.getState().openModal('createCompany');
}

/** Type `name` into the input and press "Create Company". */
async function submit(name: string): Promise<void> {
  const input = screen.getByPlaceholderText('Enter company name...');
  fireEvent.change(input, { target: { value: name } });
  await act(async () => {
    fireEvent.click(screen.getByText('Create Company'));
  });
}

beforeEach(() => {
  resetStores();
  useGameStore.setState({ companyCreationClusters: [] });
});

describe('CompanyCreationModal name guard', () => {
  it('renders nothing when another modal holds the slot', () => {
    useUiStore.getState().openModal('settings');
    const { container } = renderWithProviders(<CompanyCreationModal />);
    expect(container.firstChild).toBeNull();
  });

  it.each([['Star & Moon Co.'], ['A+B Holdings']])(
    'sends %s — the server never refused & or +',
    async (name) => {
      const onCreateCompanySubmit = jest.fn(async (..._args: unknown[]) => undefined);
      open();
      renderWithProviders(
        <CompanyCreationModal />,
        { clientCallbacks: createSpiedCallbacks({ onCreateCompanySubmit }) },
      );

      await submit(name);

      expect(onCreateCompanySubmit).toHaveBeenCalledWith(name, 'PGI');
    },
  );

  it.each([
    ['My..Corp', 'Company name cannot contain ".."'],
    ['My{Corp', 'Company name cannot contain: \\ / : * ? " < > | { } %'],
    ['My}Corp', 'Company name cannot contain: \\ / : * ? " < > | { } %'],
    ['50% Off', 'Company name cannot contain: \\ / : * ? " < > | { } %'],
  ])('refuses %s with its reason and sends nothing', async (name, reason) => {
    const onCreateCompanySubmit = jest.fn(async (..._args: unknown[]) => undefined);
    open();
    renderWithProviders(
      <CompanyCreationModal />,
      { clientCallbacks: createSpiedCallbacks({ onCreateCompanySubmit }) },
    );

    await submit(name);

    expect(screen.getByText(reason)).toBeTruthy();
    expect(onCreateCompanySubmit).not.toHaveBeenCalled();
  });

  it('refuses a blank name before any round-trip', async () => {
    const onCreateCompanySubmit = jest.fn(async (..._args: unknown[]) => undefined);
    open();
    renderWithProviders(
      <CompanyCreationModal />,
      { clientCallbacks: createSpiedCallbacks({ onCreateCompanySubmit }) },
    );

    await submit('   ');

    expect(screen.getByText('Company name cannot be empty')).toBeTruthy();
    expect(onCreateCompanySubmit).not.toHaveBeenCalled();
  });
});
