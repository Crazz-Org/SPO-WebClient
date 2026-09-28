/**
 * NewVersionBanner — "New version available" + Reload after a reconnect finds a new deploy
 * (issue 1050). No close control; the Reload button goes through the page-reload seam.
 */

jest.mock('../../page-reload', () => ({ reloadPage: jest.fn() }));

import { render, screen, fireEvent } from '@testing-library/react';
import { reloadPage } from '../../page-reload';
import { useUiStore } from '../../store/ui-store';
import { NewVersionBanner } from './NewVersionBanner';

const reload = reloadPage as jest.Mock;

afterEach(() => {
  useUiStore.setState({ newVersionAvailable: false });
  reload.mockClear();
});

describe('NewVersionBanner', () => {
  it('renders nothing while the flag is false', () => {
    const { container } = render(<NewVersionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the notice and a single Reload button when the flag is true', () => {
    useUiStore.setState({ newVersionAvailable: true });
    render(<NewVersionBanner />);
    expect(screen.getByText('New version available')).toBeInTheDocument();
    const buttons = screen.queryAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Reload');
  });

  it('clicking Reload calls the reload seam once', () => {
    useUiStore.setState({ newVersionAvailable: true });
    render(<NewVersionBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
