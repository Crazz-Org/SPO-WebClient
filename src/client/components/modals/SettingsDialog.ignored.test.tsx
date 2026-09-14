/**
 * SettingsDialog — the Ignored Players section (#622).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useChatStore } from '../../store/chat-store';
import { useUiStore } from '../../store/ui-store';
import { SettingsDialog } from './SettingsDialog';

function setup() {
  return renderWithProviders(<SettingsDialog />);
}

describe('SettingsDialog ignored players', () => {
  beforeEach(() => {
    resetStores();
    useUiStore.getState().openModal('settings');
    useChatStore.setState({ ignored: [] });
  });

  it('shows the empty state when nobody is ignored', () => {
    setup();
    expect(screen.getByText('No ignored players')).toBeTruthy();
  });

  it('lists ignored names, and stop-ignoring removes one of them', () => {
    useChatStore.setState({ ignored: ['Bob', 'Carol'] });
    setup();

    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Carol')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Stop ignoring Bob'));
    expect(useChatStore.getState().ignored).toEqual(['Carol']);
  });

  it('Clear all empties the list', () => {
    useChatStore.setState({ ignored: ['Bob', 'Carol'] });
    setup();

    fireEvent.click(screen.getByText('Clear all'));
    expect(useChatStore.getState().ignored).toEqual([]);
  });

  it('does not render Clear all when the list is empty', () => {
    setup();
    expect(screen.queryByText('Clear all')).toBeNull();
  });
});
