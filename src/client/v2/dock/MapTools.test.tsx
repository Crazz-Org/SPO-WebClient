import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { MapTools } from './MapTools';

describe('v2 MapTools', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ connectMode: { active: false, subject: '' } });
  });

  it('every RightRail control calls the same client callback', () => {
    const spies = {
      onZoomIn: jest.fn(),
      onZoomOut: jest.fn(),
      onRotateCCW: jest.fn(),
      onRotateCW: jest.fn(),
      onToggleMinimap: jest.fn(),
      onRefreshMap: jest.fn(),
      onToggleDebugOverlay: jest.fn(),
    };
    renderWithProviders(<MapTools />, { clientCallbacks: createSpiedCallbacks(spies) });
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
    click('Zoom in (+)');
    click('Zoom out (−)');
    click('Rotate view left (Q)');
    click('Rotate view right (W)');
    click('Docked minimap');
    click('Refresh map (R)');
    click('Debug overlay (D)');
    for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('Map overlays toggles the overlays panel and shows it is open', () => {
    renderWithProviders(<MapTools />);
    const btn = screen.getByRole('button', { name: 'Map overlays' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(useUiStore.getState().leftPanel).toBe('overlays');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(useUiStore.getState().leftPanel).toBeNull();
  });

  it('shows a tooltip with the shortcut, and mutes the debug tool', () => {
    renderWithProviders(<MapTools />);
    const zoom = screen.getByRole('button', { name: 'Zoom in (+)' });
    expect(zoom.textContent).toBe('Zoom in+');
    expect(zoom.querySelector('kbd')?.textContent).toBe('+');
    expect(screen.getByRole('button', { name: 'Debug overlay (D)' }).className).toContain('muted');
    expect(screen.getByRole('button', { name: 'Docked minimap' }).querySelector('kbd')).toBeNull();
  });

  it('slides left while a surface is open, but not during connect mode', () => {
    renderWithProviders(<MapTools />);
    const nav = screen.getByRole('navigation', { name: 'Map controls' });
    expect(nav.className).not.toContain('shifted');
    act(() => useUiStore.getState().toggleRightPanel('mail'));
    expect(nav.className).toContain('shifted');
    act(() => useUiStore.setState({ connectMode: { active: true, subject: 'x' } }));
    expect(nav.className).not.toContain('shifted');
  });
});
