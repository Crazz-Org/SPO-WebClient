/**
 * Smoke tests for PromptDialog component.
 */

import { describe, it, expect } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { PromptDialog } from './PromptDialog';

describe('PromptDialog smoke tests', () => {
  const defaultProps = {
    title: 'Rename Building',
    message: 'Enter a new name:',
    onSubmit: () => {},
    onCancel: () => {},
  };

  it('renders title and message', () => {
    renderWithProviders(<PromptDialog {...defaultProps} />);
    expect(screen.getByText('Rename Building')).toBeTruthy();
    expect(screen.getByText('Enter a new name:')).toBeTruthy();
  });

  it('renders with placeholder', () => {
    renderWithProviders(<PromptDialog {...defaultProps} placeholder="Building name" />);
    expect(screen.getByPlaceholderText('Building name')).toBeTruthy();
  });

  it('renders with default value', () => {
    renderWithProviders(<PromptDialog {...defaultProps} defaultValue="Old Factory" />);
    const input = screen.getByDisplayValue('Old Factory');
    expect(input).toBeTruthy();
  });

  it('submit button is disabled when input is empty', () => {
    renderWithProviders(<PromptDialog {...defaultProps} />);
    const submitBtn = screen.getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('submit button is enabled when input has content', () => {
    renderWithProviders(<PromptDialog {...defaultProps} defaultValue="Factory" />);
    const submitBtn = screen.getByText('Submit') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('calls onCancel when Cancel button is clicked', () => {
    let cancelled = false;
    renderWithProviders(
      <PromptDialog {...defaultProps} onCancel={() => { cancelled = true; }} />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(cancelled).toBe(true);
  });

  it('calls onSubmit with trimmed value', () => {
    let submitted = '';
    renderWithProviders(
      <PromptDialog
        {...defaultProps}
        defaultValue="  My Building  "
        onSubmit={(v) => { submitted = v; }}
      />,
    );
    fireEvent.click(screen.getByText('Submit'));
    expect(submitted).toBe('My Building');
  });

  it('Enter submits the trimmed value; Enter on an empty field does nothing', () => {
    let submitted = '';
    renderWithProviders(<PromptDialog {...defaultProps} onSubmit={(v) => { submitted = v; }} />);
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submitted).toBe('');
    fireEvent.change(input, { target: { value: '  Mill  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submitted).toBe('Mill');
  });

  it('type="password" renders a password input', () => {
    renderWithProviders(<PromptDialog {...defaultProps} type="password" />);
    const input = document.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('type="password" submits the untrimmed value', () => {
    let submitted = '';
    renderWithProviders(
      <PromptDialog {...defaultProps} type="password" onSubmit={(v) => { submitted = v; }} />,
    );
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  pw  ' } });
    fireEvent.click(screen.getByText('Submit'));
    expect(submitted).toBe('  pw  ');
  });
});
