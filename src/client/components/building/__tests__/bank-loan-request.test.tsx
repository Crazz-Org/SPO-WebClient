/**
 * The bank borrow box — offered to a visitor, absent in your own bank (issue 571).
 *
 * Voyager inverts this one control against every other on the sheet:
 * `fbRequest.Enabled := not fOwnsFacility` and `eBorrow.Enabled := not
 * fOwnsFacility` (Voyager/BankGeneralSheet.pas:156,:160), while `btnClose`,
 * `btnDemolish`, `peInterest`, `peTerm` and `peBankBudget` are all plain
 * `:= fOwnsFacility` (:154-159).
 *
 * The four verdicts come from the `bank-loan-request` L1 scenario's own
 * constants, so the UI test and the protocol test cannot drift apart.
 */

import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import { BANK_LOAN_VERDICTS, bankLoanOutcomeOf } from '@/shared/building-details';
import { BANK_LOAN_RAW_AMOUNT } from '@/mock-server/scenarios/bank-loan-request-scenario';
import type { BuildingPropertyValue, BuildingDetailsResponse, BuildingDetailsTab } from '@/shared/types';

const X = 118;
const Y = 226;
/** Its own visual class: `registerInspectorTabs` caches per class. */
const BANK_CLASS = '571';

const BANK_TABS: BuildingDetailsTab[] = [
  { id: 'bankGeneral', name: 'GENERAL', order: 0, icon: 'i', handlerName: 'BankGeneral' },
];

const CACHED: Record<string, string> = {
  Name: 'First Bank of Helartia',
  Creator: 'Blue Inc.',
  CurrBlock: '130200101',
  EstLoan: '5000000',
  Interest: '12',
  Term: '5',
  BudgetPerc: '75',
  Stopped: '0',
};

const PROPS: BuildingPropertyValue[] =
  Object.entries(CACHED).map(([name, value]) => ({ name, value })) as BuildingPropertyValue[];

function seed(isOwner: boolean): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-571',
    x: X, y: Y,
    visualClass: BANK_CLASS,
    templateName: 'Bank',
    buildingName: 'First Bank of Helartia',
    ownerName: 'Blue Inc.',
    securityId: 'sec-1',
    canGovern: false,
    tabs: BANK_TABS,
    groups: { bankGeneral: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ isLoading: false, currentTab: 'bankGeneral', isOwner });
}

function renderTab(onRequestBankLoan: LoanSpy) {
  return renderWithProviders(
    <PropertyGroup properties={PROPS} buildingX={X} buildingY={Y} />,
    {
      clientCallbacks: createSpiedCallbacks({
        onRequestBankLoan: onRequestBankLoan as unknown as (...a: unknown[]) => unknown,
      }),
    },
  );
}

/** The bridge callback resolves the raw TBankRequestResult ordinal. */
type LoanSpy = jest.Mock<Promise<number>, [number, number, string]>;

function loanSpy(ordinal: number): LoanSpy {
  // Both type arguments, so `toHaveBeenCalledWith(x, y, amount)` below is checked
  // against the real three-argument bridge signature rather than against the
  // zero-parameter implementation.
  return jest.fn<Promise<number>, [number, number, string]>(async () => ordinal);
}

beforeEach(() => {
  resetStores();
  jest.clearAllMocks();
});

describe('the legacy inversion (BankGeneralSheet.pas:156,:160)', () => {
  it("offers the Amount box and the Request button in another tycoon's bank", () => {
    seed(false);
    renderTab(loanSpy(0));

    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request' })).toBeInTheDocument();
  });

  it('withholds both in your own bank, and prints no raw _loanRequest row', () => {
    seed(true);
    const { container } = renderTab(loanSpy(0));

    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request' })).toBeNull();
    expect(container.textContent).not.toContain('_loanRequest');
    expect(container.textContent).not.toContain('Borrow');
  });

  it('prefills the box with the Estimated Loan, as the visitor branch does (:161-162)', () => {
    seed(false);
    renderTab(loanSpy(0));

    expect(screen.getByLabelText('Amount')).toHaveValue(CACHED.EstLoan);
  });
});

describe('the four verdicts, each distinguished on screen', () => {
  it.each([0, 1, 2, 3])('ordinal %i renders its own message and its own class', async (ordinal) => {
    seed(false);
    const spy = loanSpy(ordinal);
    const { container } = renderTab(spy);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    });

    const expected = BANK_LOAN_VERDICTS[bankLoanOutcomeOf(ordinal)];
    const verdict = await waitFor(() => screen.getByRole('status'));
    expect(verdict).toHaveTextContent(expected.message);
    // One tone class per tone, and nothing generic: the three tones never share
    // a class, so an "approved" that rendered the error style would fail here.
    expect(verdict.className).toContain(expected.tone === 'success' ? 'Success' : expected.tone === 'warning' ? 'Warning' : 'Error');
    expect(container.textContent).toContain(expected.message);
  });

  it('sends the typed text to the bridge, raw — the gateway sanitises it', async () => {
    seed(false);
    const spy = loanSpy(0);
    renderTab(spy);

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: BANK_LOAN_RAW_AMOUNT } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    });

    expect(spy).toHaveBeenCalledWith(X, Y, BANK_LOAN_RAW_AMOUNT);
  });

  it('refuses to ask for an amount the server could not read', () => {
    seed(false);
    renderTab(loanSpy(0));

    const input = screen.getByLabelText('Amount');
    for (const text of ['', '-100', 'abc', '0']) {
      fireEvent.change(input, { target: { value: text } });
      expect(screen.getByRole('button', { name: 'Request' })).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: '$1,000' } });
    expect(screen.getByRole('button', { name: 'Request' })).toBeEnabled();
  });
});

describe('typing clears the previous verdict (:472-480)', () => {
  it('removes the verdict as soon as the amount is touched', async () => {
    seed(false);
    renderTab(loanSpy(0));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request' }));
    });
    expect(await waitFor(() => screen.getByRole('status'))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1000' } });

    expect(screen.queryByRole('status')).toBeNull();
  });
});
