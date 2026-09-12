/**
 * The invention detail heading shows the same name the clicked list row
 * showed (issue 577), not the raw invention id — the server already
 * defaults `name` to the id when the .dat index has no entry
 * (session-utils.ts:130), so "name equals id" is exactly that case.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { act, screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { ResearchPanel } from '../ResearchPanel';
import type { ResearchCategoryData, ResearchInventionItem } from '@/shared/types';

const X = 10;
const Y = 20;

const ENRICHED: ResearchInventionItem = {
  inventionId: 'GreenTech.Level1',
  name: 'Green Technology',
  enabled: true,
  parent: 'Green',
};

const ID_ONLY: ResearchInventionItem = {
  inventionId: 'Rare.Thing',
  name: 'Rare.Thing',
  enabled: true,
  parent: 'Green',
};

function inventory(): ResearchCategoryData {
  return {
    categoryIndex: 0,
    available: [ENRICHED, ID_ONLY],
    developing: [],
    completed: [],
  };
}

function seedResearch(overrides: Partial<{
  selectedInventionId: string | null;
  selectedDetails: { inventionId: string; properties: string; description: string } | null;
}> = {}): void {
  useBuildingStore.setState({
    research: {
      inventoryByCategory: new Map([[0, inventory()]]),
      activeCategoryIndex: 0,
      categoryTabs: [],
      loadedCategories: new Set([0]),
      selectedInventionId: overrides.selectedInventionId ?? null,
      selectedDetails: overrides.selectedDetails ?? null,
      isLoadingInventory: false,
      isLoadingDetails: false,
    },
  });
}

function renderPanel(onResearchGetDetails: (...a: unknown[]) => unknown) {
  const onResearchLoadInventory = jest.fn();
  const onResearchFetchCategoryTabs = jest.fn();
  const utils = renderWithProviders(<ResearchPanel buildingX={X} buildingY={Y} />, {
    clientCallbacks: createSpiedCallbacks({
      onResearchGetDetails,
      onResearchLoadInventory,
      onResearchFetchCategoryTabs,
    }),
  });
  return { ...utils, onResearchLoadInventory, onResearchFetchCategoryTabs };
}

function setDetailsForSelection(inventionId: string): void {
  act(() => {
    const research = useBuildingStore.getState().research;
    if (!research) throw new Error('research state missing');
    useBuildingStore.setState({
      research: {
        ...research,
        selectedInventionId: inventionId,
        selectedDetails: { inventionId, properties: 'p', description: 'd' },
      },
    });
  });
}

beforeEach(() => {
  resetStores();
  seedResearch();
});

describe('the research detail heading is the same name the list row showed', () => {
  it('shows the display name for an item enriched from the .dat index', async () => {
    const onResearchGetDetails = jest.fn();
    const { onResearchLoadInventory } = renderPanel(onResearchGetDetails as never);

    fireEvent.click(screen.getByRole('button', { name: /Green/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Green Technology' }));
    setDetailsForSelection('GreenTech.Level1');

    expect(screen.getAllByText('Green Technology')).toHaveLength(2);
    expect(onResearchGetDetails).toHaveBeenCalledTimes(1);
    expect(onResearchGetDetails).toHaveBeenCalledWith(X, Y, 'GreenTech.Level1');
    // The mount effect fires the inventory load once; selecting an invention
    // fires no further request to resolve its name.
    expect(onResearchLoadInventory).toHaveBeenCalledTimes(1);
  });

  it('shows the id for an item absent from the .dat index, where name equals id', async () => {
    const onResearchGetDetails = jest.fn();
    const { onResearchLoadInventory } = renderPanel(onResearchGetDetails as never);

    fireEvent.click(screen.getByRole('button', { name: /Green/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Rare.Thing' }));
    setDetailsForSelection('Rare.Thing');

    expect(screen.getAllByText('Rare.Thing')).toHaveLength(2);
    expect(onResearchGetDetails).toHaveBeenCalledTimes(1);
    expect(onResearchGetDetails).toHaveBeenCalledWith(X, Y, 'Rare.Thing');
    expect(onResearchLoadInventory).toHaveBeenCalledTimes(1);
  });

  it('shows the id, never an empty heading, for a selection absent from the loaded inventory', () => {
    seedResearch({
      selectedInventionId: 'Ghost.Id',
      selectedDetails: { inventionId: 'Ghost.Id', properties: 'p', description: 'd' },
    });
    const onResearchGetDetails = jest.fn();
    renderPanel(onResearchGetDetails as never);

    const heading = document.querySelector('[class*="detailHeader"]');
    expect(heading?.textContent).toBe('Ghost.Id');
  });
});
