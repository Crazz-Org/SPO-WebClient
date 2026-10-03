import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks, resetStores } from '../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../store/building-store';
import { setWorldToScreenCenteredFn } from '../../bridge/client-bridge';
import { registerCivicVisualClass, clearCivicVisualClassIds } from '@/shared/building-details/civic-buildings';
import type { BuildingFocusInfo } from '@/shared/types';
import { FocusCard } from './FocusCard';

const focus: BuildingFocusInfo = {
  buildingId: '12345',
  buildingName: 'Drug Store',
  ownerName: 'SPO_test3 - Green',
  salesInfo: 'Pharmaceutics sales at 80%\nCosmetics sales at 20%\nToys sales at 50%\nBooks sales at 70%',
  revenue: '$1,200/h',
  detailsText: 'Upgrade Level: 3  Items Sold: 40/h  Potential customers (per day): 1 hi, 6 mid, 2083 low. Actual customers: 1 hi, 3 mid, 949 low.  Efficiency: 89%  Desirability: 51',
  hintsText: 'Warning: This facility needs more qualified work force.',
  x: 100, y: 200, xsize: 2, ysize: 2,
  visualClass: '300',
};

let screenFn: jest.Mock<(x: number, y: number, xs: number, ys: number) => { x: number; y: number; textureHeight: number }>;

function show(over: Partial<BuildingFocusInfo> = {}, overlay = true): void {
  useBuildingStore.setState({ focusedBuilding: { ...focus, ...over }, isOverlayMode: overlay });
}

describe('FocusCard', () => {
  beforeEach(() => {
    resetStores();
    screenFn = jest.fn(() => ({ x: 400, y: 300, textureHeight: 64 }));
    setWorldToScreenCenteredFn(screenFn);
  });

  afterEach(() => {
    clearCivicVisualClassIds();
    jest.restoreAllMocks();
  });

  it('renders nothing without a focused building', () => {
    renderWithProviders(<FocusCard />);
    expect(screen.queryByTestId('status-overlay')).toBeNull();
  });

  it('renders nothing outside overlay mode', async () => {
    show({}, false);
    renderWithProviders(<FocusCard />);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(screen.queryByTestId('status-overlay')).toBeNull();
  });

  it('waits for a screen position before showing', async () => {
    screenFn.mockImplementation(() => null as unknown as { x: number; y: number; textureHeight: number });
    show();
    renderWithProviders(<FocusCard />);
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    expect(screen.queryByTestId('status-overlay')).toBeNull();
    expect(screenFn).toHaveBeenCalledWith(100, 200, 2, 2);
  });

  // jsdom lays nothing out (offset sizes are 0), so the card is placed with FALLBACK_CARD_SIZE
  // (280 × 220) on jsdom's 1024 × 768 window; placeFocusCard's own tests cover the maths.
  it('sits centred above the building, its bottom the caret gap over the texture top', async () => {
    screenFn.mockImplementation(() => ({ x: 400, y: 400, textureHeight: 64 }));
    show();
    renderWithProviders(<FocusCard />);
    const card = await screen.findByTestId('status-overlay');
    expect(card.style.left).toBe(`${400 - 140}px`);
    expect(card.style.top).toBe(`${400 - 8 - 220}px`);
    expect(card.getAttribute('data-side')).toBe('above');
    expect(card.getAttribute('aria-label')).toBe('Drug Store summary');
  });

  it('flips below a building near the top of the view, clamped inside the viewport', async () => {
    screenFn.mockImplementation(() => ({ x: 1010, y: 60, textureHeight: 64 }));
    show();
    renderWithProviders(<FocusCard />);
    const card = await screen.findByTestId('status-overlay');
    expect(card.getAttribute('data-side')).toBe('below');
    expect(card.style.top).toBe(`${60 + 64 + 8}px`);
    expect(card.style.left).toBe(`${1024 - 8 - 280}px`);
    const caret = card.lastElementChild as HTMLElement;
    expect(caret.getAttribute('aria-hidden')).toBe('true');
    expect(caret.className).toContain('caretBelow');
    expect(caret.style.left).toBe(`${280 - 16}px`);
  });

  it('states identity, revenue, diagnosis, two figures, top sales and what was left out', async () => {
    show();
    renderWithProviders(<FocusCard />);
    await screen.findByTestId('status-overlay');

    expect(screen.getByText('Drug Store')).toBeTruthy();
    expect(screen.getByText('Lvl 3')).toBeTruthy();
    expect(screen.getByText('SPO_test3 - Green')).toBeTruthy();
    expect(screen.getByText('$1,200/h')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy(); // the diagnosis banner
    expect(screen.getByText('Efficiency')).toBeTruthy();
    expect(screen.getByText('89%')).toBeTruthy();
    expect(screen.getByText('Customers')).toBeTruthy();
    expect(screen.getByText(/of 1 hi, 6 mid, 2083 low/)).toBeTruthy();
    expect(screen.getByText('Pharmaceutics')).toBeTruthy();
    expect(screen.queryByText('Books')).toBeNull();
    // 2 figures + 1 sales line not shown
    expect(screen.getByText('+3 more in the inspector')).toBeTruthy();
  });

  it('Inspect calls onInspectFocusedBuilding', async () => {
    show();
    const onInspectFocusedBuilding = jest.fn();
    renderWithProviders(<FocusCard />, { clientCallbacks: createSpiedCallbacks({ onInspectFocusedBuilding }) });
    const btn = await screen.findByTestId('inspect-button');
    expect(btn.textContent).toContain('Inspect');
    fireEvent.click(btn);
    expect(onInspectFocusedBuilding).toHaveBeenCalledTimes(1);
  });

  it('a civic building offers Visit', async () => {
    registerCivicVisualClass('9999');
    show({ visualClass: '9999', detailsText: '', salesInfo: '', hintsText: '', revenue: '' });
    renderWithProviders(<FocusCard />);
    const btn = await screen.findByTestId('inspect-button');
    expect(btn.textContent).toContain('Visit');
  });

  it('shows a raw hint, a note, unparsed sales text and falling / flat revenue', async () => {
    show({
      hintsText: 'This facility belongs to Someone. There are no hints for you.',
      detailsText: '???',
      salesInfo: 'Nothing for sale yet',
      revenue: '(-$36/h)',
      ownerName: '',
    });
    renderWithProviders(<FocusCard />);
    await screen.findByTestId('status-overlay');
    expect(screen.getByText(/belongs to Someone/)).toBeTruthy();
    expect(screen.getByText('???')).toBeTruthy();
    expect(screen.getByText('Nothing for sale yet')).toBeTruthy();
    expect(screen.getByText('(-$36/h)')).toBeTruthy();
    expect(screen.queryByText(/more in the/)).toBeNull();

    act(() => show({ revenue: '$0/h', detailsText: '', salesInfo: '', hintsText: '' }));
    expect(screen.getByText('$0/h')).toBeTruthy();
  });

  it('omits the meta row when there is neither owner nor revenue, and figures without qualifier tone the value', async () => {
    show({ ownerName: '', revenue: '', detailsText: 'Upgrade Level: 1  Items Sold: 18/h  Efficiency: 92%  Desirability: 53', salesInfo: '', hintsText: '' });
    const { container } = renderWithProviders(<FocusCard />);
    await screen.findByTestId('status-overlay');
    expect(container.querySelector('[class*="metaRow"]')).toBeNull();
    expect(screen.getByText('92%').className).toContain('tonePositive');
  });

  it('a civic building counts what it left out "in the building"', async () => {
    registerCivicVisualClass('9999');
    show({ visualClass: '9999', detailsText: '143 High class (0% unemp), 385 Middle class (15% unemp), 4,981 Low class (57% unemp).', salesInfo: '', hintsText: '' });
    renderWithProviders(<FocusCard />);
    await screen.findByTestId('status-overlay');
    expect(screen.getByText('+2 more in the building')).toBeTruthy();
  });

  it('follows the building every frame and stops when unmounted', async () => {
    const cancel = jest.spyOn(window, 'cancelAnimationFrame');
    show();
    const { unmount } = renderWithProviders(<FocusCard />);
    const card = await screen.findByTestId('status-overlay');
    screenFn.mockImplementation(() => ({ x: 500, y: 400, textureHeight: 64 }));
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(card.style.left).toBe(`${500 - 140}px`);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it('hides when the focus goes', async () => {
    show();
    renderWithProviders(<FocusCard />);
    await screen.findByTestId('status-overlay');
    act(() => useBuildingStore.setState({ focusedBuilding: null }));
    expect(screen.queryByTestId('status-overlay')).toBeNull();
  });
});
