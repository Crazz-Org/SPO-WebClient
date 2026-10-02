import { describe, it, expect, jest } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../__tests__/setup/render-helpers';
import { SURFACE_TITLES } from '../../components/sheet';
import type { SurfaceKind } from '../../store/ui-store';
import { breadcrumbs, OWN_HEADER, SURFACE_ICONS, SurfaceRoute, surfaceTitle } from './surface-route';

jest.mock('../inspector/InspectorV2', () => ({ InspectorV2: () => <div>INSPECTOR V2</div> }));
jest.mock('../../components/sheet/Sheet', () => {
  const actual = jest.requireActual('../../components/sheet/Sheet') as typeof import('../../components/sheet/Sheet');
  return { ...actual, SurfaceContent: ({ kind }: { kind: SurfaceKind }) => <div>{`CLASSIC ${kind}`}</div> };
});

const KINDS = Object.keys(SURFACE_TITLES) as SurfaceKind[];

describe('surface-route', () => {
  it('every surface kind has an icon and the classic title', () => {
    for (const kind of KINDS) {
      expect(SURFACE_ICONS[kind]).toBeTruthy();
      expect(surfaceTitle(kind)).toBe(SURFACE_TITLES[kind]);
    }
  });

  it('the contents that draw their own heading are the classic sheet\'s', () => {
    expect([...OWN_HEADER].sort()).toEqual(['build', 'building', 'supplierSearch']);
  });

  it('building goes to the v2 inspector', () => {
    renderWithProviders(<SurfaceRoute kind="building" />);
    expect(screen.getByText('INSPECTOR V2')).toBeTruthy();
  });

  it('every other surface is the classic content', () => {
    for (const kind of KINDS.filter((k) => k !== 'building')) {
      const { unmount } = renderWithProviders(<SurfaceRoute kind={kind} />);
      expect(screen.getByText(`CLASSIC ${kind}`)).toBeTruthy();
      unmount();
    }
  });

  describe('breadcrumbs', () => {
    it('is empty for an empty stack', () => {
      expect(breadcrumbs([])).toEqual([]);
    });

    it('marks the top as current and keeps every label up to three surfaces', () => {
      const crumbs = breadcrumbs([{ kind: 'building' }, { kind: 'search' }, { kind: 'mail' }]);
      expect(crumbs.map((c) => c.label)).toEqual(['Building Inspector', 'Search', 'Mail']);
      expect(crumbs.map((c) => c.current)).toEqual([false, false, true]);
      expect(crumbs.some((c) => c.collapsed)).toBe(false);
      expect(crumbs.map((c) => c.index)).toEqual([0, 1, 2]);
    });

    it('collapses the middle crumbs past three surfaces', () => {
      const crumbs = breadcrumbs([{ kind: 'empire' }, { kind: 'building' }, { kind: 'search' }, { kind: 'politics' }]);
      expect(crumbs.map((c) => c.collapsed)).toEqual([false, true, true, false]);
    });
  });
});
