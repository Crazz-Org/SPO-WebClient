import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useUiStore, type SurfaceKind } from '../../store/ui-store';
import { SidePanel } from './SidePanel';
import * as barrel from './index';
import { FocusCard } from './FocusCard';
import { surfaceTitle } from './surface-route';

// The panel's job is chrome + routing; the contents are stubbed.
jest.mock('../inspector/InspectorV2', () => ({ InspectorV2: () => <div>INSPECTOR V2</div> }));
jest.mock('../../components/sheet', () => {
  const actual = jest.requireActual('../../components/sheet') as typeof import('../../components/sheet');
  return {
    SURFACE_TITLES: actual.SURFACE_TITLES,
    SurfaceContent: ({ kind }: { kind: SurfaceKind }) => {
      if (kind === 'tutorial') throw new Error('boom');
      return <div>{`CLASSIC ${kind}`}</div>;
    },
  };
});

function open(...kinds: SurfaceKind[]): void {
  act(() => {
    useUiStore.getState().setRootSurface({ kind: kinds[0] });
    for (const k of kinds.slice(1)) useUiStore.getState().pushSurface({ kind: k });
  });
}

describe('SidePanel', () => {
  beforeEach(() => {
    act(() => {
      useUiStore.getState().clearSurfaces();
      useUiStore.getState().setPinned(false);
      useUiStore.getState().setConnectMode(false);
    });
  });

  it('is exported, with FocusCard, from the barrel', () => {
    expect(barrel.SidePanel).toBe(SidePanel);
    expect(barrel.FocusCard).toBe(FocusCard);
  });

  it('renders nothing when the stack is empty', () => {
    const { container } = renderWithProviders(<SidePanel />);
    expect(container.querySelector('aside')).toBeNull();
  });

  it('routes a classic surface, names the region and gives it a heading', () => {
    open('mail');
    renderWithProviders(<SidePanel />);
    expect(screen.getByRole('region', { name: 'Mail' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mail' })).toBeTruthy();
    expect(screen.getByText('CLASSIC mail')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Open surfaces' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Back to/ })).toBeNull();
  });

  it('routes the building to the v2 inspector, adds no heading and no classic building actions', () => {
    open('building');
    renderWithProviders(<SidePanel />);
    expect(screen.getByText('INSPECTOR V2')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Building Inspector' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Building Inspector' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'View on map' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });

  it.each(['build', 'building', 'supplierSearch'] as const)(
    '%s draws its own heading: the header keeps the name for assistive tech only, never drawn twice',
    (kind) => {
      open(kind);
      renderWithProviders(<SidePanel />);
      const name = surfaceTitle(kind);
      expect(screen.getByRole('region', { name })).toBeTruthy();
      const hidden = screen.getByText(name);
      expect(hidden.className).toContain('srOnly');
      expect(hidden.previousElementSibling?.getAttribute('title')).toBe(name);
    }
  );

  it('shows the stack as a breadcrumb; a crumb returns to that surface', () => {
    open('building', 'search');
    renderWithProviders(<SidePanel />);
    expect(screen.getByRole('navigation', { name: 'Open surfaces' })).toBeTruthy();
    expect(screen.getByText('CLASSIC search')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Search' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Building Inspector' }));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['building']);
    expect(screen.getByText('INSPECTOR V2')).toBeTruthy();
  });

  it('Back pops one surface', () => {
    open('politics', 'building', 'supplierSearch');
    renderWithProviders(<SidePanel />);
    // supplierSearch draws its own heading: the name is plain text, marked current
    expect(screen.queryByRole('heading', { name: 'Find Suppliers' })).toBeNull();
    expect(screen.getByText('Find Suppliers').getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Building Inspector' }));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['politics', 'building']);
  });

  it('collapses the middle crumbs of a deep stack, keeping their names reachable', () => {
    open('empire', 'building', 'search', 'politics');
    renderWithProviders(<SidePanel />);
    const middle = screen.getByRole('button', { name: 'Building Inspector' });
    expect(middle.textContent).toBe('…');
    expect(middle.getAttribute('title')).toBe('Building Inspector');
    expect(screen.getByRole('button', { name: 'Search' }).textContent).toBe('…');
    expect(screen.getByRole('button', { name: 'Profile' }).textContent).toBe('Profile');
  });

  it('pin toggles the pinned state; close clears the stack', () => {
    open('politics');
    const { container } = renderWithProviders(<SidePanel />);
    fireEvent.click(screen.getByRole('button', { name: /Pin panel/ }));
    expect(useUiStore.getState().pinned).toBe(true);
    expect(container.querySelector('aside')?.className).toContain('pinned');
    fireEvent.click(screen.getByRole('button', { name: /Unpin panel/ }));
    expect(useUiStore.getState().pinned).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useUiStore.getState().stack).toEqual([]);
  });

  it('slides in, and leaves once the stack is cleared', async () => {
    open('mail');
    const { container } = renderWithProviders(<SidePanel />);
    await waitFor(() => expect(container.querySelector('aside')?.className).toContain('open'));
    act(() => useUiStore.getState().clearSurfaces());
    expect(container.querySelector('aside')?.className).toContain('closed');
    await waitFor(() => expect(container.querySelector('aside')).toBeNull());
  });

  it('hides while connect mode runs — the stack survives underneath (N10)', async () => {
    act(() => useUiStore.getState().setConnectMode(true, 'Fabrics'));
    open('building', 'supplierSearch');
    const { container } = renderWithProviders(<SidePanel />);
    expect(container.querySelector('aside')).toBeNull();
    expect(useUiStore.getState().stack).toHaveLength(2);
    act(() => useUiStore.getState().setConnectMode(false));
    expect(container.querySelector('aside')).not.toBeNull();
  });

  it('Escape pops one surface (the global dismissTopmost the panel relies on)', () => {
    open('building', 'search');
    renderWithProviders(<SidePanel />);
    act(() => useUiStore.getState().dismissTopmost());
    expect(screen.getByText('INSPECTOR V2')).toBeTruthy();
  });

  it('a crashing surface is contained by the error boundary; the next surface renders', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    open('tutorial');
    renderWithProviders(<SidePanel />);
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
    open('mail');
    expect(screen.getByText('CLASSIC mail')).toBeTruthy();
    err.mockRestore();
  });
});
