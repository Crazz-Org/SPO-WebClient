import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { MobileMenu } from './MobileMenu';

describe('MobileMenu', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ commandPaletteOpen: false, mobileTab: 'more' });
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

  it('Logout is reachable on mobile and asks before leaving', () => {
    useUiStore.getState().closeModal();
    const onLogout = jest.fn();
    renderWithProviders(<MobileMenu />, { clientCallbacks: createSpiedCallbacks({ onLogout }) });

    fireEvent.click(screen.getByRole('button', { name: /Logout/ }));

    expect(onLogout).not.toHaveBeenCalled();
    expect(useUiStore.getState().modal).toBe('confirm');

    useUiStore.getState().confirmPayload?.onConfirm();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
