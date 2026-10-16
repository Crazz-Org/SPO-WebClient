/**
 * LegacyMarquee (TMarquee) and LegacyBlockTicker — the moving texts of the legacy frame.
 * jsdom lays nothing out, so a box is 100 × 10 px and a caption 10 px per character.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { act, render } from '@testing-library/react';
import { LegacyMarquee } from './LegacyMarquee';
import { LegacyBlockTicker } from './LegacyBlockTicker';

const props = ['clientWidth', 'clientHeight', 'offsetWidth'] as const;
const saved = props.map((p) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, p));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 10 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) { return (this.textContent ?? '').length * 10; },
  });
});

afterAll(() => {
  props.forEach((p, i) => {
    const d = saved[i];
    if (d) Object.defineProperty(HTMLElement.prototype, p, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p];
  });
});

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

const tick = (n: number) => act(() => { jest.advanceTimersByTime(40 * n); });

function spans(container: HTMLElement) {
  return Array.from(container.querySelectorAll('span')) as HTMLSpanElement[];
}

describe('LegacyMarquee', () => {
  it('keeps a caption that fits at the left margin, with no second copy', () => {
    const { container } = render(<LegacyMarquee text="Hello" direction="up" />);
    tick(3);
    const [first, second] = spans(container);
    expect(first.textContent).toBe('Hello');
    expect(first.style.transform).toBe('translateX(5px)');
    expect(second.hidden).toBe(true);
  });

  it('scrolls a caption too long for the line, a copy following, and wraps around', () => {
    const long = 'A caption much longer than the line';
    const { container } = render(<LegacyMarquee text={long} direction="down" />);
    const [first, second] = spans(container);
    tick(1);
    expect(first.style.transform).toBe('translateX(3px)');
    expect(second.hidden).toBe(false);
    // 350 px of text has to leave on the left before the line starts over at GAP
    tick(200);
    const x = Number(/translateX\((-?\d+)px\)/.exec(first.style.transform)?.[1]);
    expect(x).toBeGreaterThan(-long.length * 10);
  });

  it('lifts the old caption out, then brings the new one in from the right', () => {
    const { container, rerender } = render(<LegacyMarquee text="Old" direction="up" />);
    tick(1);
    rerender(<LegacyMarquee text="New" direction="up" />);
    const line = container.firstElementChild?.firstElementChild as HTMLDivElement;
    tick(2);
    expect(line.style.transform).toBe('translateY(-4px)');
    expect(spans(container)[0].textContent).toBe('Old');
    tick(3);
    expect(spans(container)[0].textContent).toBe('New');
    expect(spans(container)[0].style.transform).toBe('translateX(100px)');
    tick(100);
    expect(spans(container)[0].style.transform).toBe('translateX(5px)');
  });

  it('changing back to the caption still shown cancels the lift', () => {
    const { container, rerender } = render(<LegacyMarquee text="Same" direction="up" />);
    rerender(<LegacyMarquee text="Other" direction="up" />);
    rerender(<LegacyMarquee text="Same" direction="up" />);
    tick(10);
    expect(spans(container)[0].textContent).toBe('Same');
  });
});

describe('LegacyBlockTicker', () => {
  it('types the caption in behind a caret, which goes when it is whole', () => {
    const { container } = render(<LegacyBlockTicker text="abc" />);
    const shown = () => (container.querySelector('[aria-hidden="true"]') as HTMLElement).textContent;
    expect(shown()).toBe('|');
    act(() => { jest.advanceTimersByTime(80); });
    expect(shown()).toBe('a|');
    act(() => { jest.advanceTimersByTime(160); });
    expect(shown()).toBe('abc');
    act(() => { jest.advanceTimersByTime(800); });
    expect(shown()).toBe('abc');
  });

  it('shows nothing for no caption', () => {
    const { container } = render(<LegacyBlockTicker text="" />);
    act(() => { jest.advanceTimersByTime(400); });
    expect((container.querySelector('[aria-hidden="true"]') as HTMLElement).textContent).toBe('');
  });
});
