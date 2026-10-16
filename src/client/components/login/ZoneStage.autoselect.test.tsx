/**
 * The region picker's default area and the legacy tab strip: a theme may name the area the
 * Universe Map opens on (`autoSelectZoneId`, from `--login-default-zone`), picked after a short
 * delay and retried once; the strip's tabs switch area in place through `onSelectZone`.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { WORLD_ZONES } from '@/shared/types';
import { AUTO_SELECT_DELAY_MS, ZoneStage } from './ZoneStage';
import { WorldStage } from './WorldStage';

const free = WORLD_ZONES.find((z) => z.id === 'free')!;

describe('ZoneStage autoSelectZoneId', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('waits before picking the named area — never in the same instant as the sign-in', () => {
    const onSelect = jest.fn();
    renderWithProviders(<ZoneStage onSelect={onSelect} isLoading={false} autoSelectZoneId="free" />);
    expect(onSelect).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(AUTO_SELECT_DELAY_MS); });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(free);
  });

  it('retries once after a failed query, then leaves it to the player', () => {
    const onSelect = jest.fn();
    const { rerender } = renderWithProviders(
      <ZoneStage onSelect={onSelect} isLoading={false} autoSelectZoneId="free" />
    );
    const cycle = () => {
      act(() => { jest.advanceTimersByTime(AUTO_SELECT_DELAY_MS * 3); });
      rerender(<ZoneStage onSelect={onSelect} isLoading={true} autoSelectZoneId="free" />);
      rerender(<ZoneStage onSelect={onSelect} isLoading={false} autoSelectZoneId="free" />);
    };
    cycle();
    cycle();
    cycle();
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('stops picking once the player clicked an area', () => {
    const onSelect = jest.fn();
    renderWithProviders(<ZoneStage onSelect={onSelect} isLoading={false} autoSelectZoneId="free" />);
    fireEvent.click(screen.getByText('BETA'));
    act(() => { jest.advanceTimersByTime(AUTO_SELECT_DELAY_MS * 3); });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 'beta' });
  });

  it('waits for a click when no area is named, or the name is unknown, or a query is running', () => {
    const onSelect = jest.fn();
    renderWithProviders(<ZoneStage onSelect={onSelect} isLoading={false} />);
    renderWithProviders(<ZoneStage onSelect={onSelect} isLoading={false} autoSelectZoneId="mars" />);
    renderWithProviders(<ZoneStage onSelect={onSelect} isLoading={true} autoSelectZoneId="free" />);
    act(() => { jest.advanceTimersByTime(AUTO_SELECT_DELAY_MS * 3); });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('WorldStage legacy tab strip', () => {
  const props = { worlds: [], onSelect: () => {}, onRetry: null, isLoading: false };

  it('loads the clicked area in place when onSelectZone is given', () => {
    const onSelectZone = jest.fn();
    const onBack = jest.fn();
    const { container } = renderWithProviders(
      <WorldStage {...props} zoneId="free" onSelectZone={onSelectZone} onBack={onBack} />
    );
    fireEvent.click(container.querySelector('[data-zone-tab="restricted"]')!);
    expect(onSelectZone).toHaveBeenCalledWith('restricted');
    expect(onBack).not.toHaveBeenCalled();
  });

  it('falls back to onBack without onSelectZone', () => {
    const onBack = jest.fn();
    const { container } = renderWithProviders(<WorldStage {...props} onBack={onBack} />);
    fireEvent.click(container.querySelector('[data-zone-tab="beta"]')!);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('lists the tabs in the original order: Free Space, Restricted Space, Beta', () => {
    const { container } = renderWithProviders(<WorldStage {...props} />);
    const ids = Array.from(container.querySelectorAll('[data-zone-tab]')).map((el) => el.getAttribute('data-zone-tab'));
    expect(ids).toEqual(['free', 'restricted', 'beta']);
  });
});
