import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ClientContext } from '../context/ClientContext';
import { createSpiedCallbacks } from '../__tests__/setup/render-helpers';
import { validateBugReport } from '../../shared/bug-report-schema';
import { reportJournal } from './journal';
import { useGameStore } from '../store/game-store';
import { useUiStore } from '../store/ui-store';
import { config } from '../../shared/config';
import * as ToastModule from '../components/common/Toast';
import { SettingsDialog } from '../components/modals/SettingsDialog';
import { MobileMenu } from '../components/mobile/MobileMenu';
// Through the barrel: that is the module main.tsx lazy-imports, so it is the surface that
// must actually resolve.
import { BugReportRoot } from './index';

let posted: string[] = [];
const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

function mockFetch(response: { ok: boolean; status?: number; body: unknown } = { ok: true, body: { ok: true, file: 'r.json' } }): void {
  (globalThis as unknown as { fetch: unknown }).fetch = ((_url: string, init: { body: string }) => {
    posted.push(init.body);
    const status = response.status ?? (response.ok ? 200 : 400);
    return Promise.resolve({ ok: response.ok, status, json: () => Promise.resolve(response.body) });
  }) as unknown as typeof fetch;
}

function stubElementFromPoint(element: Element | null): void {
  (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => element;
}

function renderRoot(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
  const callbacks = createSpiedCallbacks({
    onGetUsername: () => 'SPO_test3',
    onGetWorld: () => 'planitia',
    ...overrides,
  });
  return render(
    <ClientContext.Provider value={callbacks}>
      <BugReportRoot />
    </ClientContext.Provider>
  );
}

function pressF8(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true, cancelable: true }));
  });
}

function clickAt(x = 50, y = 20): void {
  act(() => {
    window.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  });
}

let target: HTMLButtonElement;

beforeEach(() => {
  posted = [];
  mockFetch();
  document.body.innerHTML = '';
  target = document.createElement('button');
  target.textContent = '  12 %  ';
  document.body.appendChild(target);
  target.getBoundingClientRect = () => ({ top: 0, left: 0, width: 10, height: 10, right: 10, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  stubElementFromPoint(target);
  reportJournal.disarm();
  reportJournal.reset();
  // Every entry point acts only in-game (the same test App.tsx uses for the game screen).
  useGameStore.setState({ status: 'connected' });
});

afterEach(() => {
  useGameStore.setState({ status: 'disconnected' });
  (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  reportJournal.disarm();
  reportJournal.reset();
  useGameStore.setState({ gameDate: null });
  useUiStore.setState({ stack: [] });
});

describe('BugReportRoot — arming', () => {
  it('renders nothing until F8', () => {
    renderRoot();
    expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
    expect(screen.queryByTestId('report-modal')).toBeNull();
  });

  it('F8 arms report mode, and F8 again disarms it', () => {
    renderRoot();
    pressF8();
    expect(screen.getByTestId('report-mode-overlay')).toBeTruthy();
    pressF8();
    expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
  });

  it('arms the journal on mount, so the 60 s before F8 are already recorded', () => {
    renderRoot();
    expect(reportJournal.isArmed).toBe(true);
  });

  it('disarms the journal on unmount', () => {
    const { unmount } = renderRoot();
    unmount();
    expect(reportJournal.isArmed).toBe(false);
  });
});

describe('BugReportRoot — capturing a DOM element', () => {
  it('opens the modal with observed pre-filled from the element text', () => {
    renderRoot();
    pressF8();
    clickAt();

    expect(screen.getByTestId('report-modal')).toBeTruthy();
    expect((screen.getByLabelText('Observed') as HTMLInputElement).value).toBe('12 %');
    // The overlay steps aside once something is captured.
    expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
  });

  it('POSTs a report the gateway validator accepts', async () => {
    renderRoot();
    pressF8();
    clickAt();
    fireEvent.change(screen.getByLabelText('Expected'), { target: { value: '15 %' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const report = JSON.parse(posted[0]) as Record<string, unknown>;

    expect(validateBugReport(report).ok).toBe(true);
    expect(report).toMatchObject({
      profile: 'desktop', kind: 'wrong-data', username: 'SPO_test3', world: 'planitia',
      observed: '12 %', expected: '15 %',
    });
    expect((report.anchor as { kind: string }).kind).toBe('dom');
    await waitFor(() => expect(screen.queryByTestId('report-modal')).toBeNull());
  });

  it('reads sessionContext from the stores at the moment of capture, not at submit', async () => {
    useGameStore.setState({ gameDate: new Date('2026-08-30T12:00:00.000Z') });
    useUiStore.setState({ stack: [{ kind: 'building' }] });
    renderRoot();
    pressF8();
    clickAt();
    // Changing the store AFTER capture must not leak into the already-captured snapshot.
    useUiStore.setState({ stack: [{ kind: 'map' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const report = JSON.parse(posted[0]) as { sessionContext: Record<string, unknown> };
    expect(report.sessionContext).toEqual({ gameDate: '2026-08-30T12:00:00.000Z', surface: 'building' });
  });

  it('reports a null surface/gameDate honestly rather than guessing', async () => {
    useGameStore.setState({ gameDate: null });
    useUiStore.setState({ stack: [] });
    renderRoot();
    pressF8();
    clickAt();
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const report = JSON.parse(posted[0]) as { sessionContext: Record<string, unknown> };
    expect(report.sessionContext).toEqual({ gameDate: null, surface: null });
  });

  it('closes the modal on a refusal too, rather than trapping the human', async () => {
    mockFetch({ ok: false, body: { error: 'nope' } });
    renderRoot();
    pressF8();
    clickAt();
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(screen.queryByTestId('report-modal')).toBeNull());
  });

  it('cancelling the modal sends nothing', () => {
    renderRoot();
    pressF8();
    clickAt();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('report-modal')).toBeNull();
    expect(posted).toEqual([]);
  });

  it('Escape while armed cancels without opening the modal', () => {
    renderRoot();
    pressF8();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
    expect(screen.queryByTestId('report-modal')).toBeNull();
  });
});

describe('BugReportRoot — capturing the map canvas', () => {
  function makeCanvas(): HTMLElement {
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.appendChild(canvas);
    canvas.getBoundingClientRect = () => ({ top: 0, left: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    stubElementFromPoint(canvas);
    return canvas;
  }

  it('routes to the renderer probe rather than the DOM walk', async () => {
    makeCanvas();
    renderRoot({
      onGetCanvasAnchor: () => ({ tileX: 412, tileY: 88, layer: 'building', visualClass: 'FarmClass' }),
      onGetCanvasScreenshot: () => 'data:image/jpeg;base64,AAA',
    });
    pressF8();
    clickAt(400, 300);

    expect(screen.getByText('map tile 412,88 (building · FarmClass)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const report = JSON.parse(posted[0]) as { anchor: Record<string, unknown> };
    expect(report.anchor).toMatchObject({
      kind: 'canvas', tileX: 412, tileY: 88, layer: 'building',
      screenshotDataUrl: 'data:image/jpeg;base64,AAA',
    });
    expect(validateBugReport(report).ok).toBe(true);
  });

  it('omits the screenshot when the canvas cannot produce one', async () => {
    makeCanvas();
    renderRoot({
      onGetCanvasAnchor: () => ({ tileX: 1, tileY: 2, layer: 'terrain' }),
      onGetCanvasScreenshot: () => null,
    });
    pressF8();
    clickAt(400, 300);
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const report = JSON.parse(posted[0]) as { anchor: Record<string, unknown> };
    expect(report.anchor).not.toHaveProperty('screenshotDataUrl');
  });

  it('refuses to anchor on a map that is not up yet', () => {
    makeCanvas();
    renderRoot({ onGetCanvasAnchor: () => null });
    pressF8();
    clickAt(400, 300);

    expect(screen.queryByTestId('report-modal')).toBeNull();
    expect(posted).toEqual([]);
  });
});

describe('BugReportRoot — the keys it does not claim', () => {
  it('leaves every other key alone', () => {
    const seen = jest.fn();
    window.addEventListener('keydown', seen);
    renderRoot();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }));
    });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
    window.removeEventListener('keydown', seen);
  });
});

// ---------------------------------------------------------------------------
// Entry points: Support, player mode, and the login screen
// ---------------------------------------------------------------------------

const flags = config.server as { bugReportMode: boolean; bugReportPlayerMode: boolean };
const savedFlags = { mode: flags.bugReportMode, player: flags.bugReportPlayerMode };
const savedWidth = window.innerWidth;
const HINT = 'Report mode — click what is wrong · Esc to cancel';

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

function setMode(player: boolean): void {
  flags.bugReportMode = true;
  flags.bugReportPlayerMode = player;
}

function renderWith(ui: React.ReactNode) {
  const callbacks = createSpiedCallbacks({ onGetUsername: () => 'SPO_test3', onGetWorld: () => 'planitia' });
  return render(
    <ClientContext.Provider value={callbacks}>
      {ui}
      <BugReportRoot />
    </ClientContext.Provider>
  );
}

function tapFab(): void {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  const el = screen.getByTestId('report-fab');
  const down = new MouseEvent('pointerdown', { clientX: 300, clientY: 700, bubbles: true }) as unknown as PointerEvent;
  const up = new MouseEvent('pointerup', { clientX: 300, clientY: 700, bubbles: true }) as unknown as PointerEvent;
  (down as unknown as { pointerId: number }).pointerId = 1;
  (up as unknown as { pointerId: number }).pointerId = 1;
  act(() => { el.dispatchEvent(down); el.dispatchEvent(up); });
}

describe('BugReportRoot — entry points', () => {
  afterEach(() => {
    flags.bugReportMode = savedFlags.mode;
    flags.bugReportPlayerMode = savedFlags.player;
    setWidth(savedWidth);
    useUiStore.setState({ modal: null, mobileTab: 'map' });
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  describe.each([
    ['dev/test', false],
    ['player', true],
  ])('Support entry (%s mode)', (_label, player) => {
    it('Settings → "Report a problem" closes the modal and arms the reporter', () => {
      setMode(player);
      setWidth(1280);
      useUiStore.getState().openModal('settings');
      renderWith(<SettingsDialog />);

      fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }));

      expect(useUiStore.getState().modal).toBeNull();
      expect(screen.getByTestId('report-mode-overlay').textContent).toContain(HINT);
    });

    it('menu → Support arms the reporter and returns to the map', () => {
      setMode(player);
      setWidth(375);
      useUiStore.setState({ mobileTab: 'more' });
      renderWith(<MobileMenu />);

      fireEvent.click(screen.getByRole('button', { name: /Support/ }));

      expect(useUiStore.getState().mobileTab).toBe('map');
      expect(screen.getByTestId('report-mode-overlay').textContent).toContain(HINT);
    });

    it('a second Support request keeps it armed rather than toggling it off', () => {
      setMode(player);
      setWidth(1280);
      renderRoot();
      act(() => { useUiStore.getState().requestReportMode(); });
      act(() => { useUiStore.getState().requestReportMode(); });
      expect(screen.getByTestId('report-mode-overlay')).toBeTruthy();
    });
  });

  describe('player mode — Support is the only way in', () => {
    it('F8 does not arm the reporter', () => {
      setMode(true);
      setWidth(1280);
      renderRoot();
      pressF8();
      expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
    });

    it('renders no floating button on mobile', () => {
      setMode(true);
      setWidth(375);
      renderRoot();
      expect(screen.queryByTestId('report-fab')).toBeNull();
    });
  });

  describe('dev/test mode — F8 and the floating button still work', () => {
    it('F8 arms the reporter', () => {
      setMode(false);
      setWidth(1280);
      renderRoot();
      pressF8();
      expect(screen.getByTestId('report-mode-overlay')).toBeTruthy();
    });

    it('the floating button is rendered on mobile, and a tap arms', () => {
      setMode(false);
      setWidth(375);
      renderRoot();
      tapFab();
      expect(screen.getByTestId('report-mode-overlay')).toBeTruthy();
    });
  });

  describe('not in game (login screen)', () => {
    beforeEach(() => {
      useGameStore.setState({ status: 'disconnected' });
    });

    it('F8 does not arm, but the journal is already recording', () => {
      setMode(false);
      setWidth(1280);
      renderRoot();
      pressF8();
      expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
      expect(reportJournal.isArmed).toBe(true);
    });

    it('the floating button is not rendered on mobile', () => {
      setMode(false);
      setWidth(375);
      renderRoot();
      expect(screen.queryByTestId('report-fab')).toBeNull();
    });

    it('a Support request does not arm', () => {
      setMode(false);
      setWidth(1280);
      renderRoot();
      act(() => { useUiStore.getState().requestReportMode(); });
      expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
    });

    it('arms once the game is reached (reconnecting counts as in-game)', () => {
      setMode(false);
      setWidth(1280);
      renderRoot();
      act(() => { useGameStore.setState({ status: 'reconnecting' }); });
      pressF8();
      expect(screen.getByTestId('report-mode-overlay')).toBeTruthy();
    });
  });

  it('a 403 refusal surfaces the gateway\'s own reason in the error toast', async () => {
    setMode(true);
    setWidth(1280);
    const toast = jest.spyOn(ToastModule, 'showToast');
    mockFetch({ ok: false, status: 403, body: { error: 'Log in to a world to send a report' } });
    renderRoot();
    act(() => { useUiStore.getState().requestReportMode(); });
    clickAt();
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Report not sent: Log in to a world to send a report', 'error'));
  });
});
