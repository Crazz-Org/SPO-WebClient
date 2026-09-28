/**
 * Tests for the ChangelogModal component ("What's New").
 *
 * Player notes (mocked here) render grouped under date headings, newest first, each with the
 * dot of its type and no version heading; closing records every note id as seen.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen, fireEvent, within } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { ChangelogModal } from './ChangelogModal';

jest.mock('../../player-notes.json', () => [
  { id: 101, date: '2026-10-01', type: 'fixed', text: 'Older fixed note.' },
  { id: 103, date: '2026-10-05', type: 'added', text: 'Newest added note.' },
  { id: 102, date: '2026-10-05', type: 'changed', text: 'Newest changed note.' },
]);

const FIXTURE_IDS = [101, 102, 103];

function storedIds(): number[] {
  return (JSON.parse(localStorage.getItem('spo-seen-notes') ?? 'null') as number[]).slice().sort((a, b) => a - b);
}

function openModal() {
  useUiStore.getState().openModal('changelog');
  renderWithProviders(<ChangelogModal />);
}

beforeEach(() => {
  resetStores();
  localStorage.clear();
});

describe('ChangelogModal', () => {
  it('renders nothing when modal is not changelog', () => {
    const { container } = renderWithProviders(<ChangelogModal />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when changelog modal is open', () => {
    openModal();
    expect(screen.getByText("What's New")).toBeTruthy();
  });

  it('renders both date headings, newest first, each note under its date', () => {
    openModal();
    const sections = screen.getByRole('dialog').querySelectorAll('section');
    expect(sections).toHaveLength(2);
    expect(within(sections[0] as HTMLElement).getByRole('heading').textContent).toBe('2026-10-05');
    expect(within(sections[1] as HTMLElement).getByRole('heading').textContent).toBe('2026-10-01');
    const newest = within(sections[0] as HTMLElement).getAllByRole('listitem').map((li) => li.textContent);
    expect(newest).toEqual(['Newest added note.', 'Newest changed note.']);
    const older = within(sections[1] as HTMLElement).getAllByRole('listitem').map((li) => li.textContent);
    expect(older).toEqual(['Older fixed note.']);
  });

  it('gives each dot the class of its type', () => {
    openModal();
    const dotOf = (text: string) => screen.getByText(text).previousElementSibling;
    expect(dotOf('Newest added note.')?.className).toContain('dotAdded');
    expect(dotOf('Newest changed note.')?.className).toContain('dotChanged');
    expect(dotOf('Older fixed note.')?.className).toContain('dotFixed');
  });

  it('renders no version heading', () => {
    openModal();
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.queryByText('Nothing new to report yet.')).toBeNull();
  });

  it('stores every note id and closes on the X button', () => {
    openModal();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(storedIds()).toEqual(FIXTURE_IDS);
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('stores every note id and closes on a backdrop click', () => {
    openModal();
    const backdrop = screen.getByRole('dialog').previousElementSibling;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(storedIds()).toEqual(FIXTURE_IDS);
    expect(useUiStore.getState().modal).toBeNull();
  });
});
