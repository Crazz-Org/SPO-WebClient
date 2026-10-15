/**
 * The region picker's default area and the legacy tab strip: a theme may name the area the
 * Universe Map opens on (`autoSelectZoneId`, from `--login-default-zone`), and the strip's
 * tabs switch area in place through `onSelectZone`.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { WORLD_ZONES } from '@/shared/types';
import { ZoneStage } from './ZoneStage';
import { WorldStage } from './WorldStage';

const free = WORLD_ZONES.find((z) => z.id === 'free')!;

describe('ZoneStage autoSelectZoneId', () => {
  it('selects the named area once, as soon as it shows', () => {
    const onSelect = jest.fn();
    const { rerender } = renderWithProviders(
      <ZoneStage onSelect={onSelect} isLoading={false} autoSelectZoneId="free" />
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(free);
    rerender(<ZoneStage onSelect={onSelect} isLoading={false} autoSelectZoneId="free" />);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('waits for a click when no area is named, or the name is unknown, or a query is running', () => {
    const onSelect = jest.fn();
    renderWithProviders(<ZoneStage onSelect={onSelect} isLoading={false} />);
    renderWithProviders(<ZoneStage onSelect={onSelect} isLoading={false} autoSelectZoneId="mars" />);
    renderWithProviders(<ZoneStage onSelect={onSelect} isLoading={true} autoSelectZoneId="free" />);
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
