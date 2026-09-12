/**
 * The one-click re-entry row on AuthStage — the return button naming the remembered
 * world and company, the forget button, and the progress line while the chain replays.
 */
import { describe, it, expect } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { AuthStage } from './AuthStage';
import type { RememberedSession } from '../../store/remembered-session';

const RECORD: RememberedSession = {
  username: 'SPO_test3',
  zonePath: 'Root/Areas/Asia/Worlds',
  worldName: 'Shamba',
  companyId: '28',
  companyName: 'Yellow Inc.',
  ownerRole: 'SPO_test3',
};

const baseProps = { onConnect: () => {}, isLoading: false, status: 'idle' };

describe('AuthStage one-click re-entry', () => {
  it('offers no return button without a remembered session', () => {
    renderWithProviders(<AuthStage {...baseProps} />);

    expect(screen.queryByLabelText(/Return to/)).toBeNull();
  });

  it('names the world and company, and pre-fills the username', () => {
    renderWithProviders(<AuthStage {...baseProps} rememberedSession={RECORD} />);

    expect(screen.getByLabelText('Return to Shamba as Yellow Inc.')).toBeTruthy();
    expect((screen.getByPlaceholderText('Username') as HTMLInputElement).value).toBe('SPO_test3');
  });

  it('calls onResume with the typed password', () => {
    const resumed: string[] = [];
    renderWithProviders(
      <AuthStage {...baseProps} rememberedSession={RECORD} onResume={(pw) => resumed.push(pw)} />,
    );

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test3' } });
    fireEvent.click(screen.getByLabelText('Return to Shamba as Yellow Inc.'));

    expect(resumed).toEqual(['test3']);
  });

  it('toasts and does not call onResume when the password is empty', () => {
    const resumed: string[] = [];
    renderWithProviders(
      <AuthStage {...baseProps} rememberedSession={RECORD} onResume={(pw) => resumed.push(pw)} />,
    );

    fireEvent.click(screen.getByLabelText('Return to Shamba as Yellow Inc.'));

    expect(resumed).toEqual([]);
  });

  it('the forget button calls onForgetSession', () => {
    let forgotten = false;
    renderWithProviders(
      <AuthStage {...baseProps} rememberedSession={RECORD} onForgetSession={() => { forgotten = true; }} />,
    );

    fireEvent.click(screen.getByLabelText('Forget remembered session'));

    expect(forgotten).toBe(true);
  });

  it('shows the progress line and no inputs while resumeTarget is set', () => {
    renderWithProviders(<AuthStage {...baseProps} rememberedSession={RECORD} resumeTarget={RECORD} />);

    expect(screen.getByText('Returning to Shamba as Yellow Inc.…')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Username')).toBeNull();
    expect(screen.queryByPlaceholderText('Password')).toBeNull();
    expect(screen.queryByLabelText('Return to Shamba as Yellow Inc.')).toBeNull();
  });
});
