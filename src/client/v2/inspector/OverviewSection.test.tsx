import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import type { BuildingFocusInfo } from '@/shared/types';
import { OverviewSection } from './OverviewSection';

const focus: BuildingFocusInfo = {
  buildingId: 'b', buildingName: 'Small Farm', ownerName: 'Co', salesInfo: 'Wheat sales at 80%',
  revenue: '$1/h', detailsText: 'Upgrade Level: 4  Producing: Wheat', hintsText: '',
  x: 1, y: 2, xsize: 1, ysize: 1, visualClass: '1',
};

describe('OverviewSection', () => {
  it('shows the details and sales, then one card per section that opens it', () => {
    const onOpen = jest.fn();
    render(<OverviewSection focus={focus} sections={[{ id: 'workforce', label: 'WORKFORCE' }]} onOpen={onOpen} />);

    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getAllByText(/Wheat/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'WORKFORCE' }));
    expect(onOpen).toHaveBeenCalledWith('workforce');
  });

  it('draws no card list for a facility without sections', () => {
    render(<OverviewSection focus={focus} sections={[]} onOpen={() => undefined} />);
    expect(screen.queryByRole('navigation', { name: 'All sections' })).toBeNull();
  });
});
