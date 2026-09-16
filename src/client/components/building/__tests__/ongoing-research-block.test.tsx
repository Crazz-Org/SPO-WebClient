/**
 * The "In research queue" block (#888): renders above the category tabs,
 * lists every `developing` item across all five categories with no false
 * active/queued distinction (#887 has not landed), and gives optimistic
 * queue/cancel feedback without waiting on the full inventory round-trip.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { ResearchPanel } from '../ResearchPanel';
import { useBuildingStore } from '../../../store/building-store';
import type { ResearchCategoryData } from '@/shared/types';
import type { ResearchPendingEntry } from '../research-utils';

const cat0: ResearchCategoryData = {
  categoryIndex: 0,
  available: [{ inventionId: 'A1', name: 'Alpha', enabled: true, parent: 'Eco' }],
  developing: [{ inventionId: 'D1', name: 'Delta', parent: 'Eco' }],
  completed: [],
};

const cat1: ResearchCategoryData = {
  categoryIndex: 1,
  available: [],
  developing: [{ inventionId: 'D2', name: 'Deuce', parent: 'Comm' }],
  completed: [],
};

/** The last tab — never the active one in these tests. */
const cat4: ResearchCategoryData = {
  categoryIndex: 4,
  available: [],
  developing: [{ inventionId: 'D4', name: 'Omega', parent: 'Civ' }],
  completed: [],
};

function seedResearch(overrides: {
  inventoryByCategory: Map<number, ResearchCategoryData>;
  pendingOps?: Map<string, ResearchPendingEntry>;
  isLoadingInventory?: boolean;
}): void {
  useBuildingStore.setState({
    isOwner: true,
    research: {
      inventoryByCategory: overrides.inventoryByCategory,
      activeCategoryIndex: 0,
      categoryTabs: [],
      loadedCategories: new Set(overrides.inventoryByCategory.keys()),
      selectedInventionId: null,
      selectedDetails: null,
      pendingOps: overrides.pendingOps ?? new Map(),
      isLoadingInventory: overrides.isLoadingInventory ?? false,
      isLoadingDetails: false,
    },
  });
}

describe('OngoingResearchBlock', () => {
  afterEach(() => {
    useBuildingStore.setState({ research: null, isOwner: false });
    resetStores();
  });

  it('precedes the tab bar in DOM order', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0]]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const all = Array.from(container.querySelectorAll('*'));
    const blockIndex = all.findIndex((el) => el.className === 'ongoingBlock');
    const tabsIndex = all.findIndex((el) => el.className.toString().includes('categoryTabs'));
    expect(blockIndex).toBeGreaterThanOrEqual(0);
    expect(tabsIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeLessThan(tabsIndex);
  });

  it('lists every developing item across two loaded categories, header reads "In research queue"', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0], [1, cat1]]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingLabel')?.textContent).toBe('In research queue');
    const names = Array.from(container.querySelectorAll('.ongoingName')).map((el) => el.textContent);
    expect(names).toEqual(['Delta', 'Deuce']);
  });

  it('asks for every category on mount, so the block can cover the whole queue', () => {
    const onResearchLoadInventory = jest.fn();
    const callbacks = createSpiedCallbacks({ onResearchLoadInventory });

    renderWithProviders(
      <ResearchPanel buildingX={10} buildingY={20} />,
      { clientCallbacks: callbacks },
    );

    expect(onResearchLoadInventory.mock.calls).toEqual([
      [10, 20, 0],
      [10, 20, 1],
      [10, 20, 2],
      [10, 20, 3],
      [10, 20, 4],
    ]);
  });

  it('lists a developing item from a category the player never opened', () => {
    const emptyCat0: ResearchCategoryData = { categoryIndex: 0, available: [], developing: [], completed: [] };
    seedResearch({ inventoryByCategory: new Map([[0, emptyCat0], [4, cat4]]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    // The open tab (0) has nothing developing; the queued item lives in tab 4.
    expect(useBuildingStore.getState().research?.activeCategoryIndex).toBe(0);
    const names = Array.from(container.querySelectorAll('.ongoingName')).map((el) => el.textContent);
    expect(names).toEqual(['Omega']);
  });

  it('does not imply progress or an active item — no "%" and no "active" wording', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0], [1, cat1]]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const block = container.querySelector('.ongoingBlock');
    expect(block?.textContent).not.toMatch(/%/);
    expect(block?.textContent).not.toMatch(/\bactive\b/i);
  });

  it('is absent when nothing is developing and nothing is pending', () => {
    const empty: ResearchCategoryData = { categoryIndex: 0, available: [], developing: [], completed: [] };
    seedResearch({ inventoryByCategory: new Map([[0, empty]]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).toBeNull();
  });

  it('stays present while isLoadingInventory is true — skeletons replace only the group list', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0]]), isLoadingInventory: true });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).not.toBeNull();
    expect(container.querySelector('.loadingList')).not.toBeNull();
  });

  it('clicking Cancel calls onResearchCancelInvention with the invention id', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0]]) });
    const onResearchCancelInvention = jest.fn();
    const callbacks = createSpiedCallbacks({ onResearchCancelInvention });

    const { container } = renderWithProviders(
      <ResearchPanel buildingX={10} buildingY={20} />,
      { clientCallbacks: callbacks },
    );

    fireEvent.click(container.querySelector('.ongoingRow .inlineBtnCancel') as HTMLButtonElement);

    expect(onResearchCancelInvention).toHaveBeenCalledWith(10, 20, 'D1');
  });

  it('has no Cancel button when isOwner is false', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0]]) });
    useBuildingStore.setState({ isOwner: false });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingRow .inlineBtnCancel')).toBeNull();
  });

  it('a fresh queue entry puts an available item in the block with the "sending…" marker', () => {
    const pendingOps = new Map<string, ResearchPendingEntry>([
      ['A1', { op: 'queue', timestamp: Date.now() }],
    ]);
    seedResearch({ inventoryByCategory: new Map([[0, cat0]]), pendingOps });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const names = Array.from(container.querySelectorAll('.ongoingName')).map((el) => el.textContent);
    expect(names).toContain('Alpha');
    expect(container.querySelector('.ongoingPending')?.textContent).toBe('sending…');
  });
});
