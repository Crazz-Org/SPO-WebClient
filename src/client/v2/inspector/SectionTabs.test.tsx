import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { screen, fireEvent, render, act } from '@testing-library/react';
import { SectionTabs } from './SectionTabs';

const tabs = [
  { id: 'a', label: 'Overview' },
  { id: 'b', label: 'General' },
  { id: 'c', label: 'Supplies' },
];

describe('SectionTabs', () => {
  it('marks the open tab and opens a tab on click', () => {
    const onSelect = jest.fn();
    render(<SectionTabs tabs={tabs} activeId="b" onSelect={onSelect} panelId="p" />);

    const general = screen.getByRole('tab', { name: 'General' });
    expect(general.getAttribute('aria-selected')).toBe('true');
    expect(general.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('tabindex')).toBe('-1');
    expect(general.getAttribute('aria-controls')).toBe('p');

    fireEvent.click(screen.getByRole('tab', { name: 'Supplies' }));
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

  describe('overflow', () => {
    const geometry = { scrollLeft: 0, clientWidth: 478, scrollWidth: 478 };
    const props = ['scrollLeft', 'clientWidth', 'scrollWidth'] as const;

    beforeEach(() => {
      geometry.scrollLeft = 0;
      geometry.clientWidth = 478;
      geometry.scrollWidth = 478;
      for (const p of props) {
        Object.defineProperty(HTMLElement.prototype, p, {
          configurable: true,
          get: () => geometry[p],
          set: (v: number) => { geometry[p] = v; },
        });
      }
    });
    afterEach(() => {
      for (const p of props) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p];
      delete (HTMLElement.prototype as { scrollBy?: unknown }).scrollBy;
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    });

    it('offers no arrow and no fade when every tab fits', () => {
      render(<SectionTabs tabs={tabs} activeId="a" onSelect={() => undefined} panelId="p" />);
      expect(screen.queryByRole('button', { name: /Scroll sections/ })).toBeNull();
      expect(screen.getByRole('tablist').className).not.toMatch(/fade/);
    });

    it('fades and offers an arrow towards hidden tabs, and the arrow scrolls the strip', () => {
      geometry.scrollWidth = 1000;
      render(<SectionTabs tabs={tabs} activeId="a" onSelect={() => undefined} panelId="p" />);
      const list = screen.getByRole('tablist');
      expect(list.className).toMatch(/fadeRight/);
      expect(list.className).not.toMatch(/fadeLeft/);
      expect(screen.queryByRole('button', { name: 'Scroll sections left' })).toBeNull();

      // No scrollBy (old engine): the strip's scrollLeft moves directly.
      fireEvent.click(screen.getByRole('button', { name: 'Scroll sections right' }));
      expect(geometry.scrollLeft).toBe(Math.round(478 * 0.7));
      expect(list.className).toMatch(/fadeLeft/);
      expect(list.className).toMatch(/fadeRight/);

      // Scrolled to the end: only the left arrow is left.
      geometry.scrollLeft = 522;
      fireEvent.scroll(list);
      expect(screen.queryByRole('button', { name: 'Scroll sections right' })).toBeNull();
      expect(list.className).not.toMatch(/fadeRight/);

      const scrollBy = jest.fn();
      Object.defineProperty(HTMLElement.prototype, 'scrollBy', { value: scrollBy, configurable: true });
      fireEvent.click(screen.getByRole('button', { name: 'Scroll sections left' }));
      expect(scrollBy).toHaveBeenCalledWith({ left: -Math.round(478 * 0.7), behavior: 'smooth' });
    });

    it('re-measures when the strip is resized, and stops watching on unmount', () => {
      let resized: (() => void) | undefined;
      const disconnect = jest.fn();
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
        constructor(cb: () => void) { resized = cb; }
        observe() { /* the strip */ }
        disconnect() { disconnect(); }
      };
      const { unmount } = render(<SectionTabs tabs={tabs} activeId="a" onSelect={() => undefined} panelId="p" />);
      expect(screen.queryByRole('button', { name: 'Scroll sections right' })).toBeNull();

      geometry.clientWidth = 300;
      act(() => resized?.());
      expect(screen.getByRole('button', { name: 'Scroll sections right' })).toBeTruthy();

      unmount();
      expect(disconnect).toHaveBeenCalled();
    });
  });
});
