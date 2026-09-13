/**
 * The bank sheet's borrow control — issue 571.
 *
 * Voyager offered exactly one control on this sheet to a player who does NOT
 * govern the bank, and it is inverted with respect to every other control there:
 * `fbRequest.Enabled := not fOwnsFacility` and `eBorrow.Enabled := not
 * fOwnsFacility` (Voyager/BankGeneralSheet.pas:156,160), the click handler
 * repeating the test (:426). The four answers of `TBankRequestResult` (:22) are
 * shown inline, one sentence each, and any touch of the amount box clears the
 * previous one (`eBorrowEnter` / `eBorrowKeyDown`, :472-480).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import { BANK_LOAN_VERDICTS } from '@/shared/building-details';
import type { BankLoanOutcome } from '@/shared/building-details';
import type { BuildingPropertyValue, BuildingDetailsResponse } from '@/shared/types';

const X = 706;
const Y = 436;
const EST_LOAN = '2500000';

function bankProps(): BuildingPropertyValue[] {
  return [
    { name: 'Name', value: 'First Bank' },
    { name: 'Creator', value: 'OtherCo' },
    { name: 'CurrBlock', value: '40133497' },
    { name: 'EstLoan', value: EST_LOAN },
    { name: 'Interest', value: '5' },
    { name: 'Term', value: '10' },
    { name: 'BudgetPerc', value: '50' },
  ] as BuildingPropertyValue[];
}

/**
 * Seed the bankGeneral tab.
 *
 * `canGovern` is the discriminator, not `isOwner`: this sheet's `fOwnsFacility`
 * is `GrantAccess(getSecurityId, SecurityId)` (:134), which the gateway computes
 * into `canGovern`. `isOwner` is left false throughout so a control that keyed
 * off it instead would be visible in both cases and fail the pair below.
 */
function seedBankTab(canGovern: boolean): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-bank',
    x: X, y: Y,
    visualClass: '1234',
    templateName: 'BankGeneral',
    buildingName: 'First Bank',
    ownerName: 'OtherCo',
    securityId: 'sec-other',
    canGovern,
    tabs: [{ id: 'bankGeneral', name: 'GENERAL', order: 0, icon: 'i', handlerName: 'BankGeneral' }],
    groups: { bankGeneral: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ currentTab: 'bankGeneral', isOwner: false });
}

/**
 * The callback under test.
 *
 * The signature is declared explicitly: `jest.fn` handed a bare zero-parameter
 * implementation pins `toHaveBeenCalledWith` to zero arguments, and the
 * assertions below pass three.
 */
function loanSpy(answer: BankLoanOutcome) {
  return jest.fn<(x: number, y: number, amount: string) => Promise<BankLoanOutcome>>(
    async () => answer,
  );
}

function renderBank(canGovern: boolean, onAskBankLoan: (...args: never[]) => unknown) {
  seedBankTab(canGovern);
  return renderWithProviders(
    <PropertyGroup properties={bankProps()} buildingX={X} buildingY={Y} />,
    { clientCallbacks: createSpiedCallbacks({ onAskBankLoan: onAskBankLoan as (...a: unknown[]) => unknown }) },
  );
}

describe('bank loan request — the inversion', () => {
  beforeEach(() => {
    resetStores();
  });

  it('is absent in your own bank', () => {
    // `fbRequest.Enabled := not fOwnsFacility` (BankGeneralSheet.pas:156).
    renderBank(true, loanSpy('approved'));

    expect(screen.queryByRole('button', { name: 'Request' })).toBeNull();
    expect(screen.queryByLabelText('Loan amount')).toBeNull();
  });

  it('is present in another tycoon\'s bank, pre-filled with the estimated loan', () => {
    // `eBorrow.Text := Properties.Values[tidEstLoan]` for a non-owner (:161-162).
    renderBank(false, loanSpy('approved'));

    expect(screen.getByRole('button', { name: 'Request' })).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Loan amount').value).toBe(EST_LOAN);
  });

  it('sends the typed amount to the bank at these coordinates', async () => {
    const spy = loanSpy('approved');
    renderBank(false, spy);

    fireEvent.change(screen.getByLabelText('Loan amount'), { target: { value: '$1,000,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith(X, Y, '$1,000,000'));
  });
});

describe('bank loan request — the four verdicts', () => {
  beforeEach(() => {
    resetStores();
  });

  const outcomes: BankLoanOutcome[] = ['approved', 'rejected', 'notEnoughFunds', 'error'];

  it.each(outcomes)('renders its own sentence for %s', async (outcome) => {
    renderBank(false, loanSpy(outcome));

    fireEvent.click(screen.getByRole('button', { name: 'Request' }));

    const verdict = await screen.findByTestId('loan-verdict');
    expect(verdict.textContent).toBe(BANK_LOAN_VERDICTS[outcome].message);
    expect(verdict.getAttribute('data-outcome')).toBe(outcome);
  });

  it('shows four different sentences across the four answers — not one generic failure', async () => {
    const seen: string[] = [];
    for (const outcome of outcomes) {
      resetStores();
      const { unmount } = renderBank(false, loanSpy(outcome));
      fireEvent.click(screen.getByRole('button', { name: 'Request' }));
      const verdict = await screen.findByTestId('loan-verdict');
      seen.push(verdict.textContent ?? '');
      unmount();
    }

    expect(new Set(seen).size).toBe(4);
  });

  it('reads a callback that answers nothing as an error', async () => {
    // The Proxy in `createSpiedCallbacks` answers an unstubbed name with a
    // no-op, i.e. `undefined` — not an outcome.
    renderBank(false, jest.fn<() => undefined>(() => undefined));

    fireEvent.click(screen.getByRole('button', { name: 'Request' }));

    const verdict = await screen.findByTestId('loan-verdict');
    expect(verdict.textContent).toBe(BANK_LOAN_VERDICTS.error.message);
  });

  it('reads a callback that throws as an error', async () => {
    renderBank(false, jest.fn<() => Promise<BankLoanOutcome>>(
      () => Promise.reject(new Error('socket gone')),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Request' }));

    const verdict = await screen.findByTestId('loan-verdict');
    expect(verdict.textContent).toBe(BANK_LOAN_VERDICTS.error.message);
  });
});

describe('bank loan request — clearing and validation', () => {
  beforeEach(() => {
    resetStores();
  });

  it('clears the shown verdict as soon as the player types again', async () => {
    // `eBorrowKeyDown` -> `LoanResult.Visible := false` (:476-480).
    renderBank(false, loanSpy('rejected'));

    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    await screen.findByTestId('loan-verdict');

    fireEvent.change(screen.getByLabelText('Loan amount'), { target: { value: '500000' } });

    expect(screen.queryByTestId('loan-verdict')).toBeNull();
  });

  it('clears the shown verdict on focus too', async () => {
    // `eBorrowEnter` -> the same assignment (:472-474).
    renderBank(false, loanSpy('approved'));

    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    await screen.findByTestId('loan-verdict');

    fireEvent.focus(screen.getByLabelText('Loan amount'));

    expect(screen.queryByTestId('loan-verdict')).toBeNull();
  });

  it('refuses a non-amount and sends nothing', () => {
    const spy = loanSpy('approved');
    renderBank(false, spy);

    fireEvent.change(screen.getByLabelText('Loan amount'), { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Enter an amount');
    expect(screen.queryByTestId('loan-verdict')).toBeNull();
  });

  it('drops the inline error once a real amount is typed', () => {
    renderBank(false, loanSpy('approved'));

    fireEvent.change(screen.getByLabelText('Loan amount'), { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    expect(screen.queryByRole('alert')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Loan amount'), { target: { value: '1000' } });

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
