/**
 * The "In research queue" block (#888): all `developing` items across every
 * loaded category, rendered above the tab bar, honestly labelled (#887 has
 * not landed — no progress/active distinction), with immediate optimistic
 * feedback for queue/cancel writes.
 */

import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { ResearchPanel } from '../ResearchPanel';
import { useBuildingStore } from '../../../store/building-store';
import type { ResearchCategoryData } from '@/shared/types';
import type { ResearchPendingEntry } from '../research-utils';

function seedResearch(overrides: {
  inventoryByCategory?: Map<number, ResearchCategoryData>;
  pendingOps?: Map<string, ResearchPendingEntry>;
  isLoadingInventory?: boolean;
}): void {
  useBuildingStore.setState({
    research: {
      inventoryByCategory: overrides.inventoryByCategory ?? new Map(),
      activeCategoryIndex: 0,
      categoryTabs: [],
      loadedCategories: new Set(overrides.inventoryByCategory?.keys() ?? []),
      selectedInventionId: null,
      selectedDetails: null,
      isLoadingInventory: overrides.isLoadingInventory ?? false,
      isLoadingDetails: false,
      pendingOps: overrides.pendingOps ?? new Map(),
    },
  });
}

const catWithDeveloping = (categoryIndex: number, developing: { inventionId: string; name: string }[]): ResearchCategoryData => ({
  categoryIndex,
  available: [],
  developing,
  completed: [],
});

describe('ResearchPanel — Ongoing research block (#888)', () => {
  afterEach(() => {
    useBuildingStore.setState({ research: null, isOwner: false });
    resetStores();
  });

  it('renders the block before the tab bar in DOM order', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, catWithDeveloping(0, [{ inventionId: 'D1', name: 'Delta' }])]]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const all = Array.from(container.querySelectorAll('*'));
    const blockIndex = all.findIndex((el) => el.classList.contains('ongoingBlock'));
    const tabsIndex = all.findIndex((el) => el.classList.contains('categoryTabs'));
    expect(blockIndex).toBeGreaterThanOrEqual(0);
    expect(tabsIndex).toBeGreaterThanOrEqual(0);
    expect(blockIndex).toBeLessThan(tabsIndex);
  });

  it('lists every developing item across two loaded categories, headed "In research queue"', () => {
    seedResearch({
      inventoryByCategory: new Map([
        [0, catWithDeveloping(0, [{ inventionId: 'D1', name: 'Delta' }])],
        [1, catWithDeveloping(1, [{ inventionId: 'D2', name: 'Echo' }])],
      ]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const block = container.querySelector('.ongoingBlock');
    expect(block?.textContent).toContain('In research queue');
    const names = Array.from(container.querySelectorAll('.ongoingName')).map((el) => el.textContent);
    expect(names).toEqual(['Delta', 'Echo']);
  });

  it('does not imply an active/queued distinction (no % or "active" wording)', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, catWithDeveloping(0, [{ inventionId: 'D1', name: 'Delta' }])]]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const block = container.querySelector('.ongoingBlock');
    expect(block?.textContent).not.toMatch(/%/);
    expect(block?.textContent).not.toMatch(/\bactive\b/i);
  });

  it('is absent when nothing is developing and nothing is pending', () => {
    seedResearch({ inventoryByCategory: new Map([[0, catWithDeveloping(0, [])]]) });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).toBeNull();
  });

  it('stays present while isLoadingInventory is true (skeletons replace only the group list)', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, catWithDeveloping(0, [{ inventionId: 'D1', name: 'Delta' }])]]),
      isLoadingInventory: true,
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).not.toBeNull();
    expect(container.querySelector('.loadingList')).not.toBeNull();
  });

  it('clicking Cancel calls onResearchCancelInvention with that invention id', () => {
    useBuildingStore.setState({ isOwner: true });
    seedResearch({
      inventoryByCategory: new Map([[0, catWithDeveloping(0, [{ inventionId: 'D1', name: 'Delta' }])]]),
    });
    const onResearchCancelInvention = jest.fn();
    const callbacks = createSpiedCallbacks({ onResearchCancelInvention });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />, { clientCallbacks: callbacks });

    fireEvent.click(container.querySelector('.ongoingRow .inlineBtnCancel') as HTMLButtonElement);

    expect(onResearchCancelInvention).toHaveBeenCalledWith(10, 20, 'D1');
  });

  it('shows no Cancel button when isOwner is false', () => {
    useBuildingStore.setState({ isOwner: false });
    seedResearch({
      inventoryByCategory: new Map([[0, catWithDeveloping(0, [{ inventionId: 'D1', name: 'Delta' }])]]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingRow .inlineBtnCancel')).toBeNull();
  });

  it('a fresh "queue" pendingOps entry puts an available item in the block with the "sending…" marker', () => {
    seedResearch({
      inventoryByCategory: new Map([[0, {
        categoryIndex: 0,
        available: [{ inventionId: 'A1', name: 'Alpha', enabled: true }],
        developing: [],
        completed: [],
      }]]),
      pendingOps: new Map([['A1', { op: 'queue', timestamp: Date.now() }]]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const block = container.querySelector('.ongoingBlock');
    expect(block?.textContent).toContain('Alpha');
    expect(container.querySelector('.ongoingPending')?.textContent).toBe('sending…');
  });
});
