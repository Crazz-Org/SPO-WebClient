/**
 * `InspectorHeader` — the identity block, and the two helpers behind it.
 *
 * The header states the facility once: name and level, society and owner,
 * revenue and ROI. Both halves of the attribution are optional — the tycoon is
 * a property read that may not have come back — and the revenue is coloured by
 * what the server printed, never recomputed here.
 */

import { describe, it, expect } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../__tests__/setup/render-helpers';
import { InspectorHeader, findPropertyValue, revenueTone } from '../InspectorHeader';
import { InspectorMenu } from '../InspectorMenu';
import type { BuildingDetailsTab } from '@/shared/types';

describe('findPropertyValue', () => {
  const groups = {
    indGeneral: [{ name: 'ROI', value: '14%' }, { name: 'Cost', value: '' }],
    workforce: [{ name: 'Workers0', value: '25' }],
  };

  it('finds a value in any group, not just the first', () => {
    expect(findPropertyValue(groups, 'Workers0')).toBe('25');
  });

  it('returns undefined for a name no group carries', () => {
    expect(findPropertyValue(groups, 'Creator')).toBeUndefined();
  });

  /** An empty string is "not read yet", not a value to print. */
  it('skips a property the cache answered with nothing', () => {
    expect(findPropertyValue(groups, 'Cost')).toBeUndefined();
  });

  it('returns undefined when there are no groups at all', () => {
    expect(findPropertyValue({}, 'ROI')).toBeUndefined();
  });
});

describe('revenueTone', () => {
  it('tells a profit, a loss, a flat zero and a blank apart', () => {
    const profit = revenueTone('$1,200/h');
    const loss = revenueTone('-$300/h');
    const zero = revenueTone('$0/h');
    const missing = revenueTone(undefined);

    expect(profit).not.toBe(loss);
    expect(zero).toBe(missing);
    expect(revenueTone('')).toBe(missing);
  });
});

describe('InspectorHeader rendering', () => {
  it('omits the level, the stats row and the attribution when it knows none of them', () => {
    renderWithProviders(<InspectorHeader buildingName="Bare Facility" />);

    expect(screen.getByText('Bare Facility')).toBeTruthy();
    expect(screen.queryByText(/^Lvl/)).toBeNull();
    expect(screen.queryByText('Revenue')).toBeNull();
    expect(screen.queryByText('ROI')).toBeNull();
  });

  it('names the owner alone when no society came back', () => {
    renderWithProviders(<InspectorHeader buildingName="Farm" owner="SPO_test3" />);
    expect(screen.getByText('SPO_test3')).toBeTruthy();
  });

  it('replaces the name with the rename control while renaming', () => {
    renderWithProviders(
      <InspectorHeader
        buildingName="Farm"
        level={2}
        nameOverride={<input aria-label="New name" defaultValue="Farm" />}
      />,
    );

    expect(screen.getByLabelText('New name')).toBeTruthy();
    // Name and level give way to the input — the row has one job at a time.
    expect(screen.queryByText('Lvl 2')).toBeNull();
  });

  it('renders the actions slot next to the name', () => {
    renderWithProviders(
      <InspectorHeader buildingName="Farm" actions={<button>Rename</button>} />,
    );
    expect(screen.getByText('Rename')).toBeTruthy();
  });

  it('omits the coordinates when only one of them is known', () => {
    renderWithProviders(<InspectorHeader buildingName="Farm" x={150} />);
    expect(screen.queryByText(/150/)).toBeNull();
  });
});

describe('InspectorHeader facility image', () => {
  it('renders no img when there is no iconUrl', () => {
    const { container } = renderWithProviders(<InspectorHeader buildingName="Farm" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('is hidden until load, then shown', () => {
    const { container } = renderWithProviders(
      <InspectorHeader buildingName="Farm" iconUrl="/cache/BuildingImages/A.gif" />,
    );

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('/cache/BuildingImages/A.gif');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.className).not.toContain('icon ');
    expect(img.className.includes('iconPending') || !img.className.includes('icon')).toBe(true);

    fireEvent.load(img);
    expect(img.className).toContain('icon');
    expect(img.className).not.toContain('iconPending');
  });

  it('unmounts the img on a failed load, without touching the rest of the header', () => {
    const { container } = renderWithProviders(
      <InspectorHeader buildingName="Farm" level={2} iconUrl="/cache/BuildingImages/A.gif" />,
    );

    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Farm')).toBeTruthy();
    expect(screen.getByText('Lvl 2')).toBeTruthy();
  });

  it('resets the load state when a rerender brings a different iconUrl', () => {
    const { container, rerender } = renderWithProviders(
      <InspectorHeader buildingName="Farm" iconUrl="/cache/BuildingImages/A.gif" />,
    );

    const first = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(first);
    expect(container.querySelector('img')).toBeNull();

    rerender(<InspectorHeader buildingName="Farm" iconUrl="/cache/BuildingImages/B.gif" />);

    const second = container.querySelector('img') as HTMLImageElement;
    expect(second).toBeTruthy();
    expect(second.getAttribute('src')).toBe('/cache/BuildingImages/B.gif');
  });
});

describe('InspectorMenu interaction', () => {
  const tabs: BuildingDetailsTab[] = [
    { id: 'a', name: 'ALPHA', order: 1, icon: '', handlerName: 'A' },
    { id: 'b', name: 'BETA', order: 0, icon: 'B', handlerName: 'B' },
  ];

  it('lists the sections in the order the server gave them', () => {
    const { container } = renderWithProviders(
      <InspectorMenu tabs={tabs} activeTab={null} onSelect={() => {}} />,
    );
    const labels = Array.from(container.querySelectorAll('nav button')).map((b) => b.textContent);
    expect(labels[0]).toContain('BETA');
    expect(labels[1]).toContain('ALPHA');
  });

  it('falls back to the first letter when a section declares no icon', () => {
    const { container } = renderWithProviders(
      <InspectorMenu tabs={tabs} activeTab={null} onSelect={() => {}} />,
    );
    expect(container.textContent).toContain('A');
  });

  it('reports the section the user picks', () => {
    const picked: (string | null)[] = [];
    renderWithProviders(
      <InspectorMenu tabs={tabs} activeTab={null} onSelect={(id) => picked.push(id)} />,
    );

    fireEvent.click(screen.getByText('ALPHA'));
    expect(picked).toEqual(['a']);
  });

  it('reports null when the user clicks the section already open', () => {
    const picked: (string | null)[] = [];
    renderWithProviders(
      <InspectorMenu tabs={tabs} activeTab="a" onSelect={(id) => picked.push(id)} />,
    );

    fireEvent.click(screen.getAllByText('ALPHA')[0]);
    expect(picked).toEqual([null]);
  });

  it('closes from the back arrow as well as the cross', () => {
    const picked: (string | null)[] = [];
    renderWithProviders(
      <InspectorMenu tabs={tabs} activeTab="a" onSelect={(id) => picked.push(id)} />,
    );

    fireEvent.click(screen.getByLabelText('Back to sections'));
    fireEvent.click(screen.getByLabelText('Close section'));
    expect(picked).toEqual([null, null]);
  });

  it('opens no drawer for an active id the tab list does not contain', () => {
    renderWithProviders(
      <InspectorMenu tabs={tabs} activeTab="nosuch" onSelect={() => {}}>
        <div>body</div>
      </InspectorMenu>,
    );
    expect(screen.queryByText('body')).toBeNull();
  });
});
