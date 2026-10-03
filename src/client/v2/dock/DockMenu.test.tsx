import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createRef } from 'react';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { DEBUG_MARKERS } from '../../debug-markers';
import { DockMenu } from './DockMenu';

function items(): string[] {
  return screen.getAllByRole('menuitem').map((el) => el.textContent ?? '');
}

describe('v2 DockMenu', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ modal: null, hudVisible: true, uiVersion: 'v2' });
    useGameStore.setState({ isRoadBuildingMode: false, isRoadDemolishMode: false, isZonePaintingMode: false, isPublicOfficeRole: false, isVisitor: false });
  });

  afterEach(() => {
    try { localStorage.clear(); } catch { /* jsdom */ }
    useUiStore.setState({ uiVersion: 'v1', hudVisible: true });
  });

  it('is the More-actions menu, keeps the debug marker, and focuses its first item', () => {
    renderWithProviders(<DockMenu onClose={jest.fn()} />);
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(menu.getAttribute('data-testid')).toBe(DEBUG_MARKERS.moreMenu);
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
    for (const name of ['Map', 'Find', 'Interface', 'Session']) {
      expect(screen.getByRole('group', { name })).toBeTruthy();
    }
  });

  it('every item calls its v1 callback (or the new interface action) and closes', () => {
    const onBuildRoad = jest.fn();
    const onDemolishRoad = jest.fn();
    const onToggleMinimap = jest.fn();
    const onSwitchServer = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(<DockMenu onClose={onClose} />, {
      clientCallbacks: createSpiedCallbacks({ onBuildRoad, onDemolishRoad, onToggleMinimap, onSwitchServer }),
    });
    const click = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }));

    click('Build road');
    expect(onBuildRoad).toHaveBeenCalledTimes(1);
    click('Demolish road');
    expect(onDemolishRoad).toHaveBeenCalledTimes(1);
    click('Docked minimap');
    expect(onToggleMinimap).toHaveBeenCalledTimes(1);
    click('Switch server');
    expect(onSwitchServer).toHaveBeenCalledTimes(1);

    click('Map overlays');
    expect(useUiStore.getState().leftPanel).toBe('overlays');
    click('My facilities');
    expect(useUiStore.getState().leftPanel).toBe('facilities');
    click('Search');
    expect(useUiStore.getState().rightPanel).toBe('search');

    click('Settings');
    expect(useUiStore.getState().modal).toBe('settings');
    click('Keyboard shortcuts');
    expect(useUiStore.getState().modal).toBe('shortcuts');

    click('Hide interface');
    expect(useUiStore.getState().hudVisible).toBe(false);
    click('Switch to classic interface');
    expect(useUiStore.getState().uiVersion).toBe('v1');

    expect(onClose).toHaveBeenCalledTimes(11);
  });

  it('zone painting: public office only; opens the picker, or cancels while painting', () => {
    const onCancelZonePainting = jest.fn();
    const { rerender } = renderWithProviders(<DockMenu onClose={jest.fn()} />, {
      clientCallbacks: createSpiedCallbacks({ onCancelZonePainting }),
    });
    expect(screen.queryByRole('menuitem', { name: /zone painting/i })).toBeNull();

    act(() => useGameStore.setState({ isPublicOfficeRole: true }));
    rerender(<DockMenu onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zone painting' }));
    expect(useUiStore.getState().modal).toBe('zonePicker');
    expect(onCancelZonePainting).not.toHaveBeenCalled();

    act(() => useGameStore.setState({ isZonePaintingMode: true }));
    rerender(<DockMenu onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop zone painting' }));
    expect(onCancelZonePainting).toHaveBeenCalledTimes(1);
  });

  it('a visitor gets no roads and no facilities', () => {
    useGameStore.setState({ isVisitor: true });
    renderWithProviders(<DockMenu onClose={jest.fn()} />);
    const labels = items();
    expect(labels.some((l) => l.includes('road'))).toBe(false);
    expect(labels.some((l) => l.includes('My facilities'))).toBe(false);
    expect(labels.some((l) => l.includes('Map overlays'))).toBe(true);
  });

  it('a running road mode shows its stop label', () => {
    useGameStore.setState({ isRoadBuildingMode: true, isRoadDemolishMode: true });
    renderWithProviders(<DockMenu onClose={jest.fn()} />);
    expect(screen.getByRole('menuitem', { name: 'Stop building roads' }).className).toContain('itemActive');
    expect(screen.getByRole('menuitem', { name: 'Stop demolishing roads' })).toBeTruthy();
  });

  it('arrow keys, Home and End move focus; other keys do not', () => {
    renderWithProviders(<DockMenu onClose={jest.fn()} />);
    const menu = screen.getByRole('menu');
    const all = screen.getAllByRole('menuitem');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(all[all.length - 1]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(all[all.length - 1]);
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(menu, { key: 'x' });
    expect(document.activeElement).toBe(all[0]);
  });

  it('closes on an outside mousedown but not on one inside or on its anchor', () => {
    const onClose = jest.fn();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const anchorRef = createRef<HTMLElement>();
    (anchorRef as { current: HTMLElement | null }).current = anchor;
    renderWithProviders(<DockMenu onClose={onClose} anchorRef={anchorRef} />);
    fireEvent.mouseDown(screen.getAllByRole('menuitem')[0]);
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(anchor);
    anchor.remove();
  });

  it('Escape closes, stops the global Escape, and refocuses the anchor', () => {
    const onClose = jest.fn();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const anchorRef = createRef<HTMLElement>();
    (anchorRef as { current: HTMLElement | null }).current = anchor;
    const bubbled = jest.fn();
    document.addEventListener('keydown', bubbled);
    renderWithProviders(<DockMenu onClose={onClose} anchorRef={anchorRef} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bubbled).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', bubbled);
    anchor.remove();
  });

  it('Escape without an anchor still closes', () => {
    const onClose = jest.fn();
    renderWithProviders(<DockMenu onClose={onClose} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
