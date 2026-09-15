import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { Sheet } from './Sheet';

// The content components are heavy; the sheet's job is chrome + routing. Stub them.
jest.mock('./BuildingSurface', () => ({ BuildingSurface: () => <div>BUILDING CONTENT</div> }));
jest.mock('../mail', () => ({ MailPanel: () => <div>MAIL CONTENT</div> }));
jest.mock('../search', () => ({ SearchPanel: () => <div>SEARCH CONTENT</div> }));
jest.mock('../empire', () => ({ ProfilePanel: () => <div>PROFILE CONTENT</div>, EmpireOverview: () => <div>FACILITIES CONTENT</div> }));
jest.mock('../hud/OverlayMenu', () => ({ OverlayMenu: () => <div>OVERLAYS CONTENT</div> }));
jest.mock('../politics/PoliticsHome', () => ({ PoliticsHome: () => <div>POLITICS CONTENT</div> }));
jest.mock('../modals/BuildMenu', () => ({ BuildMenu: ({ embedded }: { embedded?: boolean }) => <div>BUILD CONTENT {embedded ? 'embedded' : ''}</div> }));
jest.mock('../tutorial', () => ({ TutorialPanel: () => <div>TUTORIAL CONTENT</div> }));
jest.mock('../modals/ConnectionPickerModal', () => ({ ConnectionPickerContent: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>PICKER CONTENT</button> }));

describe('Sheet', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.getState().setPinned(false);
  });

  it('renders nothing when the stack is empty', () => {
    const { container } = renderWithProviders(<Sheet />);
    expect(container.querySelector('aside')).toBeNull();
  });

  it('hides while connect mode runs — the stack survives underneath (N10)', () => {
    act(() => {
      useUiStore.getState().setRootSurface({ kind: 'building' });
      useUiStore.getState().pushSurface({ kind: 'supplierSearch' });
      useUiStore.getState().setConnectMode(true, 'Fabrics');
    });
    const { container } = renderWithProviders(<Sheet />);
    expect(container.querySelector('aside')).toBeNull();
    expect(useUiStore.getState().stack).toHaveLength(2);
    act(() => useUiStore.getState().setConnectMode(false));
    expect(container.querySelector('aside')).not.toBeNull();
  });

  it('routes the top surface to its content and names the region', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'mail' }));
    renderWithProviders(<Sheet />);
    expect(screen.getByRole('region', { name: 'Mail' })).toBeTruthy();
    expect(screen.getByText('MAIL CONTENT')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Mail' })).toBeTruthy();
  });

  it('routes the tutorial surface, under the legacy label', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'tutorial' }));
    renderWithProviders(<Sheet />);
    // 'Tutorial' is the label eNewTycon.lng:89 gave the Profile-page button.
    expect(screen.getByRole('region', { name: 'Tutorial' })).toBeTruthy();
    expect(screen.getByText('TUTORIAL CONTENT')).toBeTruthy();
    // Not in OWN_HEADER: the sheet supplies the heading AND the close affordance.
    expect(screen.getByRole('heading', { name: 'Tutorial' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('the building content draws its own header, so the sheet adds none', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'building' }));
    renderWithProviders(<Sheet />);
    expect(screen.getByText('BUILDING CONTENT')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Building Inspector' })).toBeNull();
  });

  it('suppresses the redundant single-surface chip trail (issue #452)', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'building' }));
    renderWithProviders(<Sheet />);
    expect(screen.queryByText('Building Inspector')).toBeNull();
    expect(screen.getByRole('region', { name: 'Building Inspector' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pin sheet/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('a root surface with its own h2 shows the title only once, not as a chip too', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'mail' }));
    renderWithProviders(<Sheet />);
    expect(screen.getAllByText('Mail')).toHaveLength(1);
  });

  it('shows the stack as chips; clicking a chip returns to that surface', () => {
    act(() => {
      useUiStore.getState().setRootSurface({ kind: 'building' });
      useUiStore.getState().pushSurface({ kind: 'search' });
    });
    renderWithProviders(<Sheet />);
    expect(screen.getByText('SEARCH CONTENT')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Building Inspector' }));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['building']);
    expect(screen.getByText('BUILDING CONTENT')).toBeTruthy();
  });

  it('collapses the middle chips to an ellipsis when the stack is deep', () => {
    act(() => {
      useUiStore.getState().setRootSurface({ kind: 'empire' });
      useUiStore.getState().pushSurface({ kind: 'building' });
      useUiStore.getState().pushSurface({ kind: 'search' });
      useUiStore.getState().pushSurface({ kind: 'politics' });
    });
    renderWithProviders(<Sheet />);
    const dots = screen.getAllByRole('button', { name: /…/ });
    expect(dots.length).toBe(2);
    expect(dots[0].getAttribute('title')).toBe('Building Inspector');
  });

  it('pin toggles the pinned state; close clears the stack', () => {
    act(() => useUiStore.getState().setRootSurface({ kind: 'politics' }));
    renderWithProviders(<Sheet />);
    fireEvent.click(screen.getByRole('button', { name: /Pin sheet/ }));
    expect(useUiStore.getState().pinned).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Unpin sheet/ }));
    expect(useUiStore.getState().pinned).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useUiStore.getState().stack).toEqual([]);
  });

  it('every surface kind has content (politics and profile included)', () => {
    for (const [kind, text] of [
      ['politics', 'POLITICS CONTENT'],
      ['empire', 'PROFILE CONTENT'],
      ['facilities', 'FACILITIES CONTENT'],
      ['overlays', 'OVERLAYS CONTENT'],
      ['build', 'BUILD CONTENT embedded'],
    ] as const) {
      act(() => useUiStore.getState().setRootSurface({ kind }));
      const { unmount } = renderWithProviders(<Sheet />);
      expect(screen.getByText(text)).toBeTruthy();
      unmount();
    }
  });

  it('the supplier search surface shows the picker while one is open and pops back on close', () => {
    const { useBuildingStore } = jest.requireActual('../../store/building-store') as typeof import('../../store/building-store');
    act(() => {
      useUiStore.getState().setRootSurface({ kind: 'building' });
      useBuildingStore.getState().setConnectionPicker({ fluidName: 'Cotton', fluidId: 'Cotton', direction: 'input', buildingX: 1, buildingY: 2 });
      useUiStore.getState().pushSurface({ kind: 'supplierSearch' });
    });
    renderWithProviders(<Sheet />);
    expect(screen.getByRole('region', { name: 'Find Suppliers' })).toBeTruthy();
    fireEvent.click(screen.getByText('PICKER CONTENT'));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['building']);
    act(() => {
      useBuildingStore.getState().clearConnectionPicker();
      useUiStore.getState().pushSurface({ kind: 'supplierSearch' });
    });
    // no picker data → nothing rendered in the body
    expect(screen.queryByText('PICKER CONTENT')).toBeNull();
  });
});
