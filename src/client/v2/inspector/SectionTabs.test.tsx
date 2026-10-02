import { describe, it, expect, jest } from '@jest/globals';
import { screen, fireEvent, render } from '@testing-library/react';
import { SectionTabs } from './SectionTabs';

const tabs = [
  { id: 'a', label: 'Overview' },
  { id: 'b', label: 'GENERAL' },
  { id: 'c', label: 'SUPPLIES' },
];

describe('SectionTabs', () => {
  it('marks the open tab and opens a tab on click', () => {
    const onSelect = jest.fn();
    render(<SectionTabs tabs={tabs} activeId="b" onSelect={onSelect} panelId="p" />);

    const general = screen.getByRole('tab', { name: 'GENERAL' });
    expect(general.getAttribute('aria-selected')).toBe('true');
    expect(general.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('tabindex')).toBe('-1');
    expect(general.getAttribute('aria-controls')).toBe('p');

    fireEvent.click(screen.getByRole('tab', { name: 'SUPPLIES' }));
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('moves with the arrow keys and ignores other keys', () => {
    const onSelect = jest.fn();
    render(<SectionTabs tabs={tabs} activeId="c" onSelect={onSelect} panelId="p" />);
    const list = screen.getByRole('tablist');

    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenLastCalledWith('a');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Overview' }));

    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith('b');

    onSelect.mockClear();
    fireEvent.keyDown(list, { key: 'x' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the first tab reachable when none is open', () => {
    const onSelect = jest.fn();
    render(<SectionTabs tabs={tabs} activeId={undefined} onSelect={onSelect} panelId="p" />);
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('scrolls the open tab into view when the browser can', () => {
    const scroll = jest.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scroll, configurable: true });
    const { rerender, unmount } = render(<SectionTabs tabs={tabs} activeId="a" onSelect={() => undefined} panelId="p" />);
    rerender(<SectionTabs tabs={tabs} activeId="c" onSelect={() => undefined} panelId="p" />);
    expect(scroll).toHaveBeenCalledTimes(2);
    unmount();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});
