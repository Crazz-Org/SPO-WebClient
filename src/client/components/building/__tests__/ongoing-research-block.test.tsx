/**
 * Component tests for the #888 "In research queue" block above the category tabs.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { ResearchPanel } from '../ResearchPanel';
import { useBuildingStore } from '../../../store/building-store';
import type { ResearchCategoryData } from '@/shared/types';
import type { ResearchPendingEntry } from '../research-utils';

function cat(categoryIndex: number, data: Partial<ResearchCategoryData>): ResearchCategoryData {
  return { categoryIndex, available: [], developing: [], completed: [], ...data };
}

function seedResearch(overrides: {
  inventoryByCategory: Map<number, ResearchCategoryData>;
  pendingOps?: Map<string, ResearchPendingEntry>;
  isLoadingInventory?: boolean;
}): void {
  useBuildingStore.setState({
    research: {
      inventoryByCategory: overrides.inventoryByCategory,
      activeCategoryIndex: 0,
      categoryTabs: [],
      loadedCategories: new Set(overrides.inventoryByCategory.keys()),
      selectedInventionId: null,
      selectedDetails: null,
      isLoadingInventory: overrides.isLoadingInventory ?? false,
      isLoadingDetails: false,
      pendingOps: overrides.pendingOps ?? new Map(),
    },
    isOwner: true,
  });
}

describe('OngoingResearchBlock', () => {
  afterEach(() => {
    useBuildingStore.setState({ research: null, isOwner: false });
    resetStores();
  });

  it('precedes the tab bar in DOM order', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat(0, { developing: [{ inventionId: 'D1', name: 'Delta' }] })]]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);
    const all = Array.from(container.querySelectorAll('*'));
    const blockIndex = all.findIndex((el) => el.classList.contains('ongoingBlock'));
    const tabsIndex = all.findIndex((el) => el.classList.contains('categoryTabs'));

    expect(blockIndex).toBeGreaterThan(-1);
    expect(tabsIndex).toBeGreaterThan(-1);
    expect(blockIndex).toBeLessThan(tabsIndex);
  });

  it('lists every developing item across two loaded categories under "In research queue"', () => {
    seedResearch({
      inventoryByCategory: new Map([
        [0, cat(0, { developing: [{ inventionId: 'D1', name: 'Delta' }] })],
        [1, cat(1, { developing: [{ inventionId: 'D2', name: 'Epsilon' }] })],
      ]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingLabel')?.textContent).toBe('In research queue');
    const names = Array.from(container.querySelectorAll('.ongoingName')).map((el) => el.textContent);
    expect(names).toEqual(['Delta', 'Epsilon']);
  });

  it('does not imply a progress percentage or an active item', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat(0, { developing: [{ inventionId: 'D1', name: 'Delta' }] })]]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);
    const text = container.querySelector('.ongoingBlock')?.textContent ?? '';

    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\bactive\b/i);
  });

  it('is absent when nothing is developing and nothing is pending', () => {
    seedResearch({ inventoryByCategory: new Map([[0, cat(0, {})]]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).toBeNull();
  });

  it('stays on screen while the group list shows skeletons after a write', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat(0, { developing: [{ inventionId: 'D1', name: 'Delta' }] })]]),
      isLoadingInventory: true,
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).not.toBeNull();
    expect(container.querySelector('.loadingList')).not.toBeNull();
  });

  it('clicking Cancel calls onResearchCancelInvention with the invention id', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat(0, { developing: [{ inventionId: 'D1', name: 'Delta' }] })]]),
    });
    const onResearchCancelInvention = jest.fn();
    const callbacks = createSpiedCallbacks({ onResearchCancelInvention });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />, {
      clientCallbacks: callbacks,
    });

    fireEvent.click(container.querySelector('.ongoingBlock .inlineBtnCancel') as HTMLButtonElement);

    expect(onResearchCancelInvention).toHaveBeenCalledWith(10, 20, 'D1');
  });

  it('renders no Cancel button when isOwner is false', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat(0, { developing: [{ inventionId: 'D1', name: 'Delta' }] })]]),
    });
    useBuildingStore.setState({ isOwner: false });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock .inlineBtnCancel')).toBeNull();
  });

  it('puts an available item with a fresh queue op in the block, marked "sending…"', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, cat(0, { available: [{ inventionId: 'A1', name: 'Alpha' }] })]]),
      pendingOps: new Map([['A1', { op: 'queue', timestamp: Date.now() }]]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingName')?.textContent).toBe('Alpha');
    expect(container.querySelector('.ongoingPending')?.textContent).toBe('sending…');
  });
});
