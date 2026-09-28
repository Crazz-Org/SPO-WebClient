import { describe, it, expect, jest } from '@jest/globals';
import { act } from 'react';
import { screen } from '@testing-library/react';

jest.mock('./client', () => ({
  StarpeaceClient: jest.fn().mockImplementation(() => ({ callbacks: {} })),
}));
jest.mock('./App', () => ({
  App: () => {
    throw new Error('app crashed');
  },
}));
jest.mock('../shared/config', () => ({ config: { server: { bugReportMode: false } } }));
jest.mock('./version', () => ({ APP_VERSION: 't', BUILD_DATE: 't', BUILD_TIME: 't', BUILD_NUMBER: 't' }));
jest.mock('./styles/design-tokens.css', () => ({}));
jest.mock('./styles/reset.css', () => ({}));
jest.mock('./styles/typography.css', () => ({}));
jest.mock('./styles/animations.css', () => ({}));

describe('main.tsx root', () => {
  it('a crash in App ends on the crash screen, not an empty page', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    document.body.innerHTML = '<div id="react-root"></div>';
    await act(async () => {
      await import('./main');
    });
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByText(/stopped responding/)).toBeTruthy();
  });
});
