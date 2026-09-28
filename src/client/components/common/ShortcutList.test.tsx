import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { screen, within, cleanup } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { SHORTCUTS } from '../../hooks/useKeyboardShortcuts';
import { ShortcutList } from './ShortcutList';
import { SettingsDialog } from '../modals/SettingsDialog';
import { ShortcutHelpDialog } from '../modals/ShortcutHelpDialog';

function rowsOf(container: HTMLElement): Array<[string, string]> {
  return within(container)
    .getAllByRole('listitem')
    .map((r) => [r.querySelector('kbd')?.textContent ?? '', r.querySelector('span')?.textContent ?? '']);
}

const TABLE: Array<[string, string]> = SHORTCUTS.map((s) => [s.keys, s.action]);

describe('ShortcutList', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null });
  });

  it('renders one row per SHORTCUTS entry, keys and actions in table order', () => {
    renderWithProviders(<ShortcutList />);
    const list = screen.getByRole('list');
    expect(rowsOf(list)).toEqual(TABLE);
  });

  it('Settings and the ? dialog show the same rows in the same order', () => {
    useUiStore.setState({ modal: 'settings' });
    renderWithProviders(<SettingsDialog />);
    const settingsRows = rowsOf(screen.getByRole('dialog', { name: 'Settings' }));
    cleanup();

    useUiStore.setState({ modal: 'shortcuts' });
    renderWithProviders(<ShortcutHelpDialog />);
    const helpRows = rowsOf(screen.getByRole('dialog', { name: 'Keyboard shortcuts' }));

    expect(settingsRows).toHaveLength(SHORTCUTS.length);
    expect(settingsRows).toEqual(TABLE);
    expect(helpRows).toEqual(settingsRows);
  });

  it('SettingsDialog.tsx holds no shortcut literal of its own', () => {
    const src = fs.readFileSync(path.join(__dirname, '../modals/SettingsDialog.tsx'), 'utf8');
    expect(src).not.toContain('ShortcutRow');
    expect(src).not.toContain('SHORTCUTS');
  });
});
