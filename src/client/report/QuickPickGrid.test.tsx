import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ClientContext } from '../context/ClientContext';
import { createSpiedCallbacks } from '../__tests__/setup/render-helpers';
import { validateBugReport, type DomAnchor, type GeometryCapture } from '../../shared/bug-report-schema';
import { analyzeGeometry } from './geometry';
import { reportJournal } from './journal';
import { QuickPickGrid, kindFromPicks } from './QuickPickGrid';
import { BugReportRoot } from './index';
import { useGameStore } from '../store/game-store';

const anchor: DomAnchor = {
  kind: 'dom',
  componentChain: ['GameScreen', 'MobileShell', 'button'],
  cssChain: 'section.panel > button.tax',
  text: '12 %',
};

function geometry(over: Partial<GeometryCapture> = {}): GeometryCapture {
  return {
    ...analyzeGeometry({
      elements: [{
        selector: 'button.tax',
        rect: { x: 10, y: 800, width: 28, height: 28 },
        styles: { fontSize: '11px', padding: '2px', overflow: 'visible', position: 'static', zIndex: 'auto', transform: 'none' },
      }],
      centrePoint: { cssChain: 'nav.bottom', isSelfOrDescendant: false },
      clipParentRect: null,
      viewport: { width: 390, height: 844 },
      devicePixelRatio: 3,
      visualViewportHeight: 844,
      safeAreaInsets: { top: 47, right: 0, bottom: 34, left: 0 },
    }),
    ...over,
  };
}

function renderGrid(over: Partial<React.ComponentProps<typeof QuickPickGrid>> = {}) {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  render(
    <QuickPickGrid anchor={anchor} geometry={geometry()} onSubmit={onSubmit} onCancel={onCancel} {...over} />
  );
  return { onSubmit, onCancel };
}

const LABELS = ['Too small', 'Covered', 'Out of reach', 'Cut off', 'Does not respond', 'Wrong data', 'Could be better'];

describe('kindFromPicks', () => {
  it('lets data beat action beat appearance — the order a wrong answer costs most', () => {
    expect(kindFromPicks(['wrong-data'])).toBe('wrong-data');
    expect(kindFromPicks(['too-small', 'wrong-data', 'no-response'])).toBe('wrong-data');
    expect(kindFromPicks(['no-response', 'covered'])).toBe('broken-action');
    expect(kindFromPicks(['too-small', 'cut-off'])).toBe('visual');
    expect(kindFromPicks([])).toBe('visual');
  });

  it('lets could-be-better win over every defect symptom — the reporter said outright it is not broken', () => {
    expect(kindFromPicks(['could-be-better'])).toBe('suggestion');
    expect(kindFromPicks(['wrong-data', 'could-be-better'])).toBe('suggestion');
    expect(kindFromPicks(['no-response', 'could-be-better', 'too-small'])).toBe('suggestion');
  });
});

describe('QuickPickGrid', () => {
  it('offers exactly the seven one-tap options', () => {
    renderGrid();
    for (const label of LABELS) expect(screen.getByRole('button', { name: label })).toBeTruthy();
  });

  it('shows what the measurements already found, before anything is typed', () => {
    renderGrid();
    expect(screen.getByText('target 28×28 px, below the 44 px minimum')).toBeTruthy();
    expect(screen.getByText('covered by nav.bottom')).toBeTruthy();
  });

  it('names the flagged element', () => {
    renderGrid();
    expect(screen.getByText('GameScreen › MobileShell › button')).toBeTruthy();
  });

  it('renders without a geometry block at all', () => {
    renderGrid({ geometry: undefined });
    expect(screen.getByTestId('report-quick-pick')).toBeTruthy();
  });

  it('toggles picks on and off, multi-select', () => {
    const { onSubmit } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Too small' }));
    fireEvent.click(screen.getByRole('button', { name: 'Covered' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cut off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cut off' }));

    expect(screen.getByRole('button', { name: 'Too small' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Cut off' }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith({
      quickPicks: ['too-small', 'covered'], kind: 'visual', freeText: '',
    });
  });

  it('is submittable on picks alone — typing on a phone breaks the test session', () => {
    const { onSubmit } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Too small' }));
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;

    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('is submittable on free text alone', () => {
    const { onSubmit } = renderGrid();
    fireEvent.change(screen.getByLabelText('Anything else (optional)'), { target: { value: 'le bouton saute' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).toHaveBeenCalledWith({ quickPicks: [], kind: 'visual', freeText: 'le bouton saute' });
  });

  it('refuses an entirely empty report', () => {
    renderGrid();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('locks the button while a report is in flight', () => {
    renderGrid({ submitting: true });
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('cancels without submitting', () => {
    const { onSubmit, onCancel } = renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('the mobile profile, end to end through BugReportRoot', () => {
  let posted: string[] = [];
  const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
  let target: HTMLButtonElement;

  beforeEach(() => {
    posted = [];
    (globalThis as unknown as { fetch: unknown }).fetch = ((_u: string, init: { body: string }) => {
      posted.push(init.body);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, file: 'm.json' }) });
    }) as unknown as typeof fetch;

    // A phone-width viewport is what puts BugReportRoot on the mobile path.
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};

    document.body.innerHTML = '';
    target = document.createElement('button');
    target.className = 'tax';
    target.textContent = '12 %';
    document.body.appendChild(target);
    target.getBoundingClientRect = () => ({
      x: 10, y: 800, width: 28, height: 28, left: 10, top: 800, right: 38, bottom: 828, toJSON: () => ({}),
    }) as DOMRect;
    (document as unknown as { elementFromPoint: unknown }).elementFromPoint = () => target;
    reportJournal.disarm();
    reportJournal.reset();
    // The floating button exists only in-game.
    useGameStore.setState({ status: 'connected' });
  });

  afterEach(() => {
    useGameStore.setState({ status: 'disconnected' });
    (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    window.localStorage.clear();
    reportJournal.disarm();
    reportJournal.reset();
  });

  function renderRoot() {
    render(
      <ClientContext.Provider value={createSpiedCallbacks({
        onGetUsername: () => 'SPO_test3',
        onGetWorld: () => 'planitia',
      })}>
        <BugReportRoot />
      </ClientContext.Provider>
    );
  }

  function tapFab(): void {
    const el = screen.getByTestId('report-fab');
    const down = new MouseEvent('pointerdown', { clientX: 300, clientY: 700, bubbles: true }) as unknown as PointerEvent;
    const up = new MouseEvent('pointerup', { clientX: 300, clientY: 700, bubbles: true }) as unknown as PointerEvent;
    (down as unknown as { pointerId: number }).pointerId = 1;
    (up as unknown as { pointerId: number }).pointerId = 1;
    act(() => { el.dispatchEvent(down); el.dispatchEvent(up); });
  }

  it('shows the FAB and no F8 listener on a phone', () => {
    renderRoot();
    expect(screen.getByTestId('report-fab')).toBeTruthy();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8', bubbles: true })); });
    expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
  });

  it('two taps produce a valid mobile report carrying its geometry', async () => {
    renderRoot();
    tapFab();
    expect(screen.getByTestId('report-mode-overlay')).toBeTruthy();

    act(() => {
      window.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 810, bubbles: true, cancelable: true }));
    });
    expect(screen.getByTestId('report-quick-pick')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Too small' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const report = JSON.parse(posted[0]) as Record<string, unknown>;

    expect(validateBugReport(report).ok).toBe(true);
    expect(report).toMatchObject({ profile: 'mobile', kind: 'visual', quickPicks: ['too-small'] });
    expect((report.geometry as GeometryCapture).elements[0].rect)
      .toEqual({ x: 10, y: 800, width: 28, height: 28 });
    expect(report).not.toHaveProperty('observed');
  });

  it('hides the FAB while the sheet is open, so it cannot sit on top of it', () => {
    renderRoot();
    tapFab();
    act(() => {
      window.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 810, bubbles: true, cancelable: true }));
    });

    expect(screen.getByTestId('report-quick-pick')).toBeTruthy();
    expect(screen.queryByTestId('report-fab')).toBeNull();
  });

  it('cancelling the sheet sends nothing and brings the button back', () => {
    renderRoot();
    tapFab();
    act(() => {
      window.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 810, bubbles: true, cancelable: true }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('report-quick-pick')).toBeNull();
    expect(screen.getByTestId('report-fab')).toBeTruthy();
    expect(posted).toEqual([]);
  });

  it('a second tap on the FAB disarms without capturing', () => {
    renderRoot();
    tapFab();
    tapFab();
    expect(screen.queryByTestId('report-mode-overlay')).toBeNull();
    expect(posted).toEqual([]);
  });
});
