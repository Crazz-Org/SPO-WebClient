import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';

jest.mock('../error-reporter', () => ({ reportClientError: jest.fn() }));

import { reportClientError } from '../error-reporter';
import { useUiStore } from '../store/ui-store';
import { ToastContainer, resetToasts } from '../components/common/Toast';
import { V2Boundary, V2_FALLBACK_MESSAGE } from './V2Boundary';

function Boom(): never {
  throw new Error('v2 exploded');
}

describe('V2Boundary', () => {
  beforeEach(() => {
    resetToasts();
    jest.mocked(reportClientError).mockClear();
    useUiStore.setState({ uiVersion: 'v2' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.removeItem('spo_ui_version');
  });

  it('renders its children when nothing fails', () => {
    render(<V2Boundary><p>fine</p></V2Boundary>);
    expect(screen.getByText('fine')).toBeTruthy();
    expect(useUiStore.getState().uiVersion).toBe('v2');
  });

  it('a render error switches back to v1, remembers it, reports it and toasts the player', () => {
    // The toast container is mounted (and listening) before the v2 tree, as in play.
    const { rerender } = render(<ToastContainer />);
    rerender(<><ToastContainer /><V2Boundary><Boom /></V2Boundary></>);
    expect(useUiStore.getState().uiVersion).toBe('v1');
    expect(localStorage.getItem('spo_ui_version')).toBe('v1');
    expect(reportClientError).toHaveBeenCalledWith('boundary', expect.any(Error));
    expect(screen.getByText(V2_FALLBACK_MESSAGE)).toBeTruthy();
  });

  it('renders nothing once it has caught (App mounts the classic screen instead)', () => {
    const { container } = render(<V2Boundary><Boom /></V2Boundary>);
    act(() => {});
    expect(container.innerHTML).toBe('');
  });
});
