import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { SHORTCUTS } from '../../hooks/useKeyboardShortcuts';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';

describe('ShortcutHelpDialog', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: 'shortcuts' });
  });

  it('is a dialog titled "Keyboard shortcuts" listing every SHORTCUTS row in table order', () => {
    renderWithProviders(<ShortcutHelpDialog />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(SHORTCUTS.length);
    const keys = rows.map((r) => r.querySelector('kbd')?.textContent);
    expect(keys).toEqual(SHORTCUTS.map((s) => s.keys));
    for (const k of ['?', 'H', 'D']) expect(keys).toContain(k);
  });

  it('has exactly one button, "Close", and no Cancel', () => {
    renderWithProviders(<ShortcutHelpDialog />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const buttons = within(dialog).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Close');
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('Close clears the modal', () => {
    renderWithProviders(<ShortcutHelpDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('Escape clears the modal', () => {
    renderWithProviders(<ShortcutHelpDialog />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('renders nothing when another modal (or none) is open', () => {
    useUiStore.setState({ modal: null });
    renderWithProviders(<ShortcutHelpDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
