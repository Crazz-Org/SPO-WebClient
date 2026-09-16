/**
 * The "In research queue" block (#888): renders above the tab bar, aggregates
 * `developing` items across every loaded category, gives immediate optimistic
 * feedback on queue/cancel, and never implies a false active/queued split
 * (#887 has not landed).
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { ResearchPanel } from '../ResearchPanel';
import { useBuildingStore } from '../../../store/building-store';
import type { ResearchCategoryData } from '@/shared/types';
import type { ResearchPendingEntry } from '../research-utils';

function seedResearch(overrides: {
  inventoryByCategory: Map<number, ResearchCategoryData>;
  loadedCategories: Set<number>;
  pendingOps?: Map<string, ResearchPendingEntry>;
  isLoadingInventory?: boolean;
}): void {
  useBuildingStore.setState({
    isOwner: true,
    research: {
      inventoryByCategory: overrides.inventoryByCategory,
      activeCategoryIndex: 0,
      categoryTabs: [],
      loadedCategories: overrides.loadedCategories,
      selectedInventionId: null,
      selectedDetails: null,
      isLoadingInventory: overrides.isLoadingInventory ?? false,
      isLoadingDetails: false,
      pendingOps: overrides.pendingOps ?? new Map(),
    },
  });
}

const cat0: ResearchCategoryData = {
  categoryIndex: 0,
  available: [{ inventionId: 'A1', name: 'Alpha', enabled: true, parent: 'Farms' }],
  developing: [{ inventionId: 'D1', name: 'Delta One', parent: 'Farms' }],
  completed: [],
};

const cat1: ResearchCategoryData = {
  categoryIndex: 1,
  available: [],
  developing: [{ inventionId: 'D2', name: 'Delta Two', parent: 'Oil' }],
  completed: [],
};

describe('ResearchPanel — In research queue block (#888)', () => {
  afterEach(() => {
    useBuildingStore.setState({ research: null, isOwner: false });
    resetStores();
  });

  it('renders before the tab bar in DOM order', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0]]), loadedCategories: new Set([0]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const nodes = Array.from(container.querySelectorAll('*'));
    const blockIndex = nodes.findIndex((n) => n.classList.contains('ongoingBlock'));
    const tabsIndex = nodes.findIndex((n) => n.classList.contains('categoryTabs'));
    expect(blockIndex).toBeGreaterThanOrEqual(0);
    expect(tabsIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeLessThan(tabsIndex);
  });

  it('lists every developing item across two loaded categories, header reads "In research queue"', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat0], [1, cat1]]),
      loadedCategories: new Set([0, 1]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingLabel')?.textContent).toBe('In research queue');
    const names = Array.from(container.querySelectorAll('.ongoingName')).map((n) => n.textContent);
    expect(names).toEqual(['Delta One', 'Delta Two']);
  });

  it('never claims a percentage or an "active" item — honest fallback labelling', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat0], [1, cat1]]),
      loadedCategories: new Set([0, 1]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);
    const text = container.querySelector('.ongoingBlock')?.textContent ?? '';

    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\bactive\b/i);
  });

  it('is absent when nothing is developing and nothing is pending', () => {
    const empty: ResearchCategoryData = { categoryIndex: 0, available: [], developing: [], completed: [] };
    seedResearch({ inventoryByCategory: new Map([[0, empty]]), loadedCategories: new Set([0]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).toBeNull();
  });

  it('stays on screen while isLoadingInventory is true — skeletons only replace the group list', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat0]]),
      loadedCategories: new Set([0]),
      isLoadingInventory: true,
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).not.toBeNull();
    expect(container.querySelector('.loadingList')).not.toBeNull();
  });

  it('clicking Cancel calls onResearchCancelInvention with that invention id', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0]]), loadedCategories: new Set([0]) });
    const onResearchCancelInvention = jest.fn();
    const callbacks = createSpiedCallbacks({ onResearchCancelInvention });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />, { clientCallbacks: callbacks });
    fireEvent.click(container.querySelector('.ongoingRow .inlineBtnCancel') as HTMLButtonElement);

    expect(onResearchCancelInvention).toHaveBeenCalledWith(10, 20, 'D1');
  });

  it('shows no Cancel button when isOwner is false', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat0]]), loadedCategories: new Set([0]) });
    useBuildingStore.setState({ isOwner: false });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingRow .inlineBtnCancel')).toBeNull();
  });

  it('a fresh queue entry puts an available item in the block with the sending marker', () => {
    const pendingOps = new Map<string, ResearchPendingEntry>([['A1', { op: 'queue', timestamp: Date.now() }]]);
    seedResearch({
      inventoryByCategory: new Map([[0, { ...cat0, developing: [] }]]),
      loadedCategories: new Set([0]),
      pendingOps,
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingName')?.textContent).toBe('Alpha');
    expect(container.querySelector('.ongoingPending')?.textContent).toBe('sending…');
  });
});
