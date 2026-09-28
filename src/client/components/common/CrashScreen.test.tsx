import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { lazy, Suspense } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('../../page-reload', () => ({ reloadPage: jest.fn() }));

import { reloadPage } from '../../page-reload';
import { AppErrorBoundary } from './CrashScreen';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

const SENTENCE = /stopped responding/;

describe('AppErrorBoundary / CrashScreen', () => {
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.mocked(reloadPage).mockClear();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('shows the crash screen when a child throws during render', () => {
    const { container } = render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByText(SENTENCE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(container.innerHTML).not.toBe('');
  });

  it('requests a page reload when Reload is clicked', () => {
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('shows the crash screen when a lazy chunk import rejects (stale chunk)', async () => {
    const Stale = lazy(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/BuildMenu-old.js'))
    );
    render(
      <AppErrorBoundary>
        <Suspense fallback={null}>
          <Stale />
        </Suspense>
      </AppErrorBoundary>
    );
    expect(await screen.findByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByText(SENTENCE)).toBeTruthy();
  });

  it('renders healthy children untouched', () => {
    render(<AppErrorBoundary><p>ok</p></AppErrorBoundary>);
    expect(screen.getByText('ok')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
  });

  it('ErrorBoundary with fallback={null} renders nothing on a crash', () => {
    const { container } = render(<ErrorBoundary fallback={null}><Boom /></ErrorBoundary>);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Something went wrong.')).toBeNull();
  });

  it('a crash in the app leaves a sibling boundary (the reporter) mounted', () => {
    render(
      <>
        <AppErrorBoundary><Boom /></AppErrorBoundary>
        <ErrorBoundary fallback={null}><p>reporter</p></ErrorBoundary>
      </>
    );
    expect(screen.getByText(SENTENCE)).toBeTruthy();
    expect(screen.getByText('reporter')).toBeTruthy();
  });
});
