/**
 * Borrowing from another tycoon's bank (issue 571).
 *
 * Two things are being held here, and both are inversions of what the rest of
 * the inspector does:
 *
 * 1. The control belongs to the VISITOR, not the owner. `eBorrow` and
 *    `fbRequest` are `Enabled := not fOwnsFacility`
 *    (Voyager/BankGeneralSheet.pas:156,160) — every other editable control on
 *    the sheet is the owner's.
 * 2. The four answers stay four. `TBankRequestResult` has three ordinals
 *    (Kernel/Kernel.pas:1750) and Voyager adds `brqError` (`:22`); each gets its
 *    own line in the panel (`:446-468`), which is what a generic failure toast
 *    would have destroyed.
 *
 * The verdicts asserted here are read off the `bank-loan` L1 scenario, so the
 * screen and the wire cannot drift apart.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { useGameStore } from '../../../store/game-store';
import { PropertyGroup } from '../PropertyGroup';
import { BANK_LOAN_LABELS } from '../BankLoanRequest';
import { BANK_LOAN_CASES } from '@/mock-server/scenarios/bank-loan-scenario';
import type { BuildingPropertyValue, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

const X = 924;
const Y = 820;
/** Its own visual class: `registerInspectorTabs` caches per class. */
const BANK_CLASS = '571';
const EST_LOAN = '5000000';

const BANK_TABS: BuildingDetailsTab[] = [
  { id: 'bankGeneral', name: 'GENERAL', order: 0, icon: 'G', handlerName: 'BankGeneral' },
];

const PROPS: BuildingPropertyValue[] = ([
  ['Name', 'First Bank'],
  ['Creator', 'Yellow Inc.'],
  ['EstLoan', EST_LOAN],
  ['Interest', '5'],
  ['Term', '10'],
  ['BudgetPerc', '50'],
  ['Stopped', '0'],
] as const).map(([name, value]) => ({ name, value })) as BuildingPropertyValue[];

function seed(isOwner: boolean): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-571',
    x: X, y: Y,
    visualClass: BANK_CLASS,
    templateName: 'Bank',
    buildingName: 'First Bank',
    ownerName: 'Yellow Inc.',
    securityId: 'sec-1',
    canGovern: false,
    tabs: BANK_TABS,
    groups: { bankGeneral: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ isLoading: false, currentTab: 'bankGeneral', isOwner });
}

function renderTab(onRequestBankLoan: (...a: unknown[]) => unknown) {
  return renderWithProviders(
    <PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />,
    { clientCallbacks: createSpiedCallbacks({ onRequestBankLoan }) },
  );
}

const box = () => screen.getByLabelText('Loan amount') as HTMLInputElement;
const requestBtn = () => screen.getByRole('button', { name: 'Request' }) as HTMLButtonElement;

beforeEach(() => {
  resetStores();
  useGameStore.setState({ status: 'connected' });
});

describe('who is offered the control', () => {
  it('hides it from the bank\'s own owner', () => {
    seed(true);
    renderTab(jest.fn());

    expect(screen.queryByLabelText('Loan amount')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request' })).toBeNull();
  });

  it('offers it to a visitor, prefilled with the bank\'s estimate', () => {
    seed(false);
    renderTab(jest.fn());

    expect(box().value).toBe(EST_LOAN);
    expect(requestBtn()).toBeTruthy();
  });
});

describe('asking for a loan', () => {
  beforeEach(() => seed(false));

  it('sends the amount stripped of its currency sign and separators', async () => {
    const spy = jest.fn<(x: number, y: number, amount: string) => Promise<string>>(async () => 'approved');
    renderTab(spy as never);

    fireEvent.change(box(), { target: { value: '$1,000,000' } });
    await act(async () => { fireEvent.click(requestBtn()); });

    expect(spy).toHaveBeenCalledWith(X, Y, '1000000');
  });

  it.each(BANK_LOAN_CASES.map(c => [c.verdict, c.ordinal] as const))(
    'shows the %s answer on its own line (ordinal %s)',
    async (verdict) => {
      const spy = jest.fn(async () => verdict);
      renderTab(spy as never);

      await act(async () => { fireEvent.click(requestBtn()); });

      const panel = screen.getByTestId('loan-verdict');
      expect(panel.getAttribute('data-verdict')).toBe(verdict);
      expect(panel.textContent).toBe(BANK_LOAN_LABELS[verdict]);
    },
  );

  it('gives the four answers four different texts', () => {
    const texts = BANK_LOAN_CASES.map(c => BANK_LOAN_LABELS[c.verdict]);
    expect(new Set(texts).size).toBe(4);
  });

  it('refuses an amount that is not a number, without sending anything', async () => {
    const spy = jest.fn(async () => 'approved');
    renderTab(spy as never);

    fireEvent.change(box(), { target: { value: 'abc' } });
    await act(async () => { fireEvent.click(requestBtn()); });

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('must be a number');
  });

  it('disables the button while the bank is answering', async () => {
    let release: ((v: string) => void) | undefined;
    const spy = jest.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    renderTab(spy as never);

    await act(async () => { fireEvent.click(requestBtn()); });
    expect(requestBtn().disabled).toBe(true);

    await act(async () => { release?.('approved'); await Promise.resolve(); });
    expect(requestBtn().disabled).toBe(false);
  });
});

describe('a new amount is not the old answer', () => {
  beforeEach(() => seed(false));

  async function showAVerdict() {
    const spy = jest.fn(async () => 'rejected');
    renderTab(spy as never);
    await act(async () => { fireEvent.click(requestBtn()); });
    expect(screen.getByTestId('loan-verdict')).toBeTruthy();
  }

  it('clears the panel when the box is typed in (:476-480)', async () => {
    await showAVerdict();

    fireEvent.change(box(), { target: { value: '2000000' } });

    expect(screen.queryByTestId('loan-verdict')).toBeNull();
  });

  it('clears the panel when the box is merely entered (:472-474)', async () => {
    await showAVerdict();

    fireEvent.focus(box());

    expect(screen.queryByTestId('loan-verdict')).toBeNull();
  });
});
