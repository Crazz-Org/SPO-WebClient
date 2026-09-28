import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { render, screen, cleanup } from '@testing-library/react';

jest.mock('../../error-reporter', () => ({ reportClientError: jest.fn() }));

import { ErrorBoundary } from './ErrorBoundary';
import { reportClientError } from '../../error-reporter';

const err = new Error('boom');
function Boom(): never {
  throw err;
}

afterEach(() => {
  cleanup();
  jest.mocked(reportClientError).mockClear();
  jest.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('reports a caught error once, still logs it and renders the fallback', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(reportClientError).toHaveBeenCalledWith('boundary', err);
    expect(screen.getByText(/Something went wrong\./)).toBeTruthy();
    expect(consoleSpy).toHaveBeenCalledWith('[ErrorBoundary]', err, expect.anything());
  });

  it('reports once with a custom fallback', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary fallback={<p>fb</p>}><Boom /></ErrorBoundary>);
    expect(screen.getByText('fb')).toBeTruthy();
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(reportClientError).toHaveBeenCalledWith('boundary', err);
  });
});
