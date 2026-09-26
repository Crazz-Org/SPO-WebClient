import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useGameStore } from '../../store/game-store';
import { MobileMenu } from './MobileMenu';
import { VISITOR_GATED_PANELS } from '../../visitor-gating';

function setSupportUrl(value: string | undefined): void {
  const w = window as unknown as Record<string, unknown>;
  if (value === undefined) {
    delete w.__SPO_SUPPORT_URL__;
  } else {
    w.__SPO_SUPPORT_URL__ = value;
  }
}

describe('MobileMenu', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ commandPaletteOpen: false, mobileTab: 'more' });
    useGameStore.setState({ isVisitor: false });
  });

  it('Profile opens the empire surface on mobile (was unreachable)', () => {
    renderWithProviders(<MobileMenu />);
    fireEvent.click(screen.getByRole('button', { name: /Profile/ }));
    expect(useUiStore.getState().leftPanel).toBe('empire');
    expect(useUiStore.getState().mobileTab).toBe('map');
  });

  it('Government opens the politics surface', () => {
    renderWithProviders(<MobileMenu />);
    fireEvent.click(screen.getByRole('button', { name: /Government/ }));
    expect(useUiStore.getState().rightPanel).toBe('politics');
  });

  it('Command palette is reachable by touch', () => {
    renderWithProviders(<MobileMenu />);
    fireEvent.click(screen.getByRole('button', { name: /Command palette/ }));
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });

  it('Rotate view reaches the client and returns to the map (N7 mobile)', () => {
    const onRotateCW = jest.fn();
    renderWithProviders(<MobileMenu />, { clientCallbacks: createSpiedCallbacks({ onRotateCW }) });
    fireEvent.click(screen.getByRole('button', { name: /Rotate view/ }));
    expect(onRotateCW).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().mobileTab).toBe('map');
  });

  it('My facilities opens the facilities surface (the former Fav tab)', () => {
    renderWithProviders(<MobileMenu />);
    fireEvent.click(screen.getByRole('button', { name: /My facilities/ }));
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['facilities']);
  });

  it('Logout asks for confirmation before calling onLogout, and confirming logs out', () => {
    const onLogout = jest.fn();
    renderWithProviders(<MobileMenu />, { clientCallbacks: createSpiedCallbacks({ onLogout }) });

    fireEvent.click(screen.getByRole('button', { name: /Logout/ }));

    expect(onLogout).not.toHaveBeenCalled();
    expect(useUiStore.getState().confirmPayload).not.toBeNull();

    useUiStore.getState().confirmPayload!.onConfirm();

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('a visitor is offered no gated panel (no Profile, no My facilities)', () => {
    useGameStore.setState({ isVisitor: true });
    renderWithProviders(<MobileMenu />);
    expect(screen.queryByRole('button', { name: /Profile/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /My facilities/ })).toBeNull();
    for (const name of [/Mail/, /Search/, /Government/]) expect(screen.getByRole('button', { name })).toBeTruthy();
    for (const button of screen.getAllByRole('button')) {
      fireEvent.click(button);
      for (const s of useUiStore.getState().stack) expect(VISITOR_GATED_PANELS.has(s.kind)).toBe(false);
    }
  });

  describe('Support', () => {
    afterEach(() => setSupportUrl(undefined));

    it('opens the configured support destination, carrying world and player, in a new tab', () => {
      setSupportUrl('https://support.example.org/support.asp');
      useGameStore.setState({ worldName: 'planitia', username: 'Crazz' });
      renderWithProviders(<MobileMenu />);

      const link = screen.getByRole('link', { name: /Support/ }) as HTMLAnchorElement;
      expect(link.href).toContain('https://support.example.org/support.asp');
      expect(link.href).toContain('WorldName=planitia');
      expect(link.href).toContain('UserName=Crazz');
      expect(link.target).toBe('_blank');
      expect(link.rel).toContain('noopener');
    });

    it('falls back to the built-in default when no destination is configured', () => {
      setSupportUrl(undefined);
      useGameStore.setState({ worldName: 'planitia', username: 'Crazz' });
      renderWithProviders(<MobileMenu />);

      const link = screen.getByRole('link', { name: /Support/ }) as HTMLAnchorElement;
      expect(link.href).toContain('github.com/Crazz-Org/SPO-WebClient/issues');
    });
  });
});
