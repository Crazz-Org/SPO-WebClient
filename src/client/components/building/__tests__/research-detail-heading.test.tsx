/**
 * The invention detail panel heading must show the display name the row
 * showed, not the raw invention id — except when there is no name to show,
 * where the id is the correct fallback (research.0.dat has no entry for it).
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { ResearchPanel } from '../ResearchPanel';
import { useBuildingStore } from '../../../store/building-store';

function seedResearch(overrides: {
  selectedInventionId: string;
  selectedDetails: { inventionId: string; properties: string; description: string };
}): void {
  useBuildingStore.setState({
    research: {
      inventoryByCategory: new Map([[0, {
        categoryIndex: 0,
        available: [
          { inventionId: 'GreenTech.Level1', name: 'Green Technology', parent: 'Eco' },
          { inventionId: 'Orphan.Thing', name: 'Orphan.Thing', parent: 'Eco' },
        ],
        developing: [],
        completed: [],
      }]]),
      activeCategoryIndex: 0,
      categoryTabs: [],
      loadedCategories: new Set([0]),
      isLoadingInventory: false,
      isLoadingDetails: false,
      pendingOps: new Map(),
      ...overrides,
    },
  });
}

describe('ResearchPanel detail heading', () => {
  afterEach(() => {
    useBuildingStore.setState({ research: null });
    resetStores();
  });

  it('shows the display name for an item enriched with one', () => {
    seedResearch({
      selectedInventionId: 'GreenTech.Level1',
      selectedDetails: { inventionId: 'GreenTech.Level1', properties: 'Price: 100', description: 'desc' },
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.detailHeader')?.textContent).toBe('Green Technology');
  });

  it('shows the id when the name equals the id (absent from the .dat index)', () => {
    seedResearch({
      selectedInventionId: 'Orphan.Thing',
      selectedDetails: { inventionId: 'Orphan.Thing', properties: 'Price: 50', description: 'desc' },
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.detailHeader')?.textContent).toBe('Orphan.Thing');
  });

  it('the heading matches the row that was clicked', () => {
    seedResearch({
      selectedInventionId: 'GreenTech.Level1',
      selectedDetails: { inventionId: 'GreenTech.Level1', properties: 'Price: 100', description: 'desc' },
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    fireEvent.click(container.querySelector('.groupHeader') as HTMLButtonElement);
    const row = container.querySelector('.inventionName') as HTMLButtonElement;
    const heading = container.querySelector('.detailHeader') as HTMLDivElement;

    expect(row.textContent).toBe('Green Technology');
    expect(heading.textContent).toBe(row.textContent);
  });

  it('resolves the name from state already in memory — no extra request', () => {
    seedResearch({
      selectedInventionId: 'GreenTech.Level1',
      selectedDetails: { inventionId: 'GreenTech.Level1', properties: 'Price: 100', description: 'desc' },
    });
    const onResearchGetDetails = jest.fn();
    const callbacks = createSpiedCallbacks({ onResearchGetDetails });

    renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />, { clientCallbacks: callbacks });

    expect(onResearchGetDetails).not.toHaveBeenCalled();
  });
});
