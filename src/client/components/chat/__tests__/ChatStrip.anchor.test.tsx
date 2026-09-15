/**
 * ChatStrip — the shifted class follows the command bar's open/closed state (#872).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { act } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useUiStore } from '../../../store/ui-store';
import { ChatStrip } from '../ChatStrip';

describe('ChatStrip anchor', () => {
  beforeEach(() => {
    resetStores();
  });

  it('gains shifted when a surface opens, and loses it again when closed', () => {
    const { container } = renderWithProviders(<ChatStrip />);
    expect(container.firstElementChild?.className).not.toContain('shifted');

    act(() => useUiStore.getState().setRootSurface({ kind: 'mail' }));
    expect(container.firstElementChild?.className).toContain('shifted');

    act(() => useUiStore.getState().clearSurfaces());
    expect(container.firstElementChild?.className).not.toContain('shifted');
  });

  it('never gains shifted in embedded mode, even with a surface open', () => {
    const { container } = renderWithProviders(<ChatStrip mode="embedded" />);
    act(() => useUiStore.getState().setRootSurface({ kind: 'mail' }));
    expect(container.firstElementChild?.className).not.toContain('shifted');
  });
});
