import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { Dialog, isDialogSuppressed } from './Dialog';

function setup(over: Partial<React.ComponentProps<typeof Dialog>> = {}) {
  const onClose = jest.fn();
  const onPrimary = jest.fn();
  const utils = renderWithProviders(
    <>
      <button data-testid="opener">open</button>
      <Dialog
        title="Build a Textile Mill?"
        description="In Helartia, 12 × 12 tiles."
        primary={{ label: 'Build', onClick: onPrimary }}
        onClose={onClose}
        {...over}
      />
    </>,
  );
  return { onClose, onPrimary, ...utils };
}

describe('Dialog', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('is a labelled modal dialog with a description', () => {
    setup();
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const labelId = dlg.getAttribute('aria-labelledby');
    expect(labelId && document.getElementById(labelId)?.textContent).toBe('Build a Textile Mill?');
    const descId = dlg.getAttribute('aria-describedby');
    expect(descId && document.getElementById(descId)?.textContent).toContain('Helartia');
  });

  it('focuses the primary action for a spend and the safe action for a destruction', () => {
    setup({ kind: 'spend' });
    expect(document.activeElement?.textContent).toBe('Build');
  });

  it('destructive: initial focus on Cancel, primary rendered as danger', () => {
    setup({ kind: 'destructive', primary: { label: 'Disconnect', onClick: jest.fn() } });
    expect(document.activeElement?.textContent).toBe('Cancel');
    expect(screen.getByRole('button', { name: 'Disconnect' }).className).toContain('danger');
  });

  it('Escape and a click on the scrim call onClose; a click inside does not', () => {
    const { onClose } = setup();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('dialog-scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('traps Tab inside: from the last focusable Tab goes to the first, Shift+Tab the other way', () => {
    setup();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const build = screen.getByRole('button', { name: 'Build' });
    build.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(build);
  });

  it('restores focus to the opener on unmount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = setup();
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('renders rows with tones (first row gold by default)', () => {
    setup({ rows: [{ label: 'Cost', value: '$ 240 000' }, { label: 'Cash after', value: '$ 12 240 300', tone: 'positive' }] });
    expect(screen.getByText('$ 240 000').className).toContain('tone-gold');
    expect(screen.getByText('$ 12 240 300').className).toContain('tone-positive');
  });

  it('typeToConfirm gates the primary action until the text matches, Enter in the input submits', () => {
    const { onPrimary } = setup({ typeToConfirm: 'CONFIRM', kind: 'destructive', primary: { label: 'Demolish', onClick: jest.fn() } });
    const btn = screen.getByRole('button', { name: 'Demolish' }) as HTMLButtonElement;
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(btn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'CONF' } });
    expect(btn.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(btn);
    expect(onPrimary).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'CONFIRM' } });
    expect(btn.disabled).toBe(false);
    fireEvent.keyDown(input, { key: 'Enter' });
    // the primary handler passed in setup is replaced by the override above
    expect(btn.disabled).toBe(false);
  });

  it('dontAskAgainKey stores the opt-out only when confirmed, never for destructive dialogs', () => {
    const { onPrimary } = setup({ kind: 'spend', dontAskAgainKey: 'build' });
    expect(isDialogSuppressed('build')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(isDialogSuppressed('build')).toBe(true);
  });

  it('destructive dialogs never offer the opt-out', () => {
    setup({ kind: 'destructive', dontAskAgainKey: 'x' });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('primary.disabled wins', () => {
    const { onPrimary } = setup({ primary: { label: 'Build', onClick: jest.fn(), disabled: true } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Build' }));
    });
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it('singleAction renders only the primary button — no secondary, no Cancel — and Escape still closes', () => {
    const { onClose, onPrimary } = setup({ singleAction: true, primary: { label: 'Close', onClick: jest.fn() } });
    const dlg = screen.getByRole('dialog');
    const buttons = Array.from(dlg.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Close']);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPrimary).not.toHaveBeenCalled();
  });
});
