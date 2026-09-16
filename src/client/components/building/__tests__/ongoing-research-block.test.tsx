/**
 * The research-queue block (#888): everything queued, above the tabs, honestly labelled.
 *
 * The wire carries no progress figure and no "which one is running" flag, so the block
 * must not imply one — the third test pins that as a rule, not a happenstance of markup.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { fireEvent } from '@testing-library/react';
import type { ResearchCategoryData } from '@/shared/types';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { ResearchPanel } from '../ResearchPanel';
import { useBuildingStore } from '../../../store/building-store';
import type { ResearchPendingEntry } from '../research-utils';

function cat(
  categoryIndex: number,
  available: ResearchCategoryData['available'],
  developing: ResearchCategoryData['developing'],
): ResearchCategoryData {
  return { categoryIndex, available, developing, completed: [] };
}

function seed(options: {
  categories: ResearchCategoryData[];
  pendingOps?: Map<string, ResearchPendingEntry>;
  isOwner?: boolean;
  isLoadingInventory?: boolean;
}): void {
  useBuildingStore.setState({
    isOwner: options.isOwner ?? true,
    research: {
      inventoryByCategory: new Map(options.categories.map((c) => [c.categoryIndex, c])),
      activeCategoryIndex: 0,
      categoryTabs: [],
      loadedCategories: new Set(options.categories.map((c) => c.categoryIndex)),
      selectedInventionId: null,
      selectedDetails: null,
      isLoadingInventory: options.isLoadingInventory ?? false,
      isLoadingDetails: false,
      pendingOps: options.pendingOps ?? new Map(),
    },
  });
}

describe('ResearchPanel — research queue block', () => {
  afterEach(() => {
    useBuildingStore.setState({ research: null, isOwner: false });
    resetStores();
  });

  it('renders above the category tab bar', () => {
    seed({ categories: [cat(0, [], [{ inventionId: 'D1', name: 'Delta' }])] });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const block = container.querySelector('.ongoingBlock')!;
    const tabs = container.querySelector('.categoryTabs')!;
    expect(block).toBeTruthy();
    expect(block.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists every developing item across categories, including one never opened as a tab', () => {
    seed({
      categories: [
        cat(0, [], [{ inventionId: 'D1', name: 'Delta' }]),
        cat(3, [], [{ inventionId: 'F1', name: 'Foxtrot' }]),
      ],
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const names = Array.from(container.querySelectorAll('.ongoingName')).map((n) => n.textContent);
    expect(names).toEqual(['Delta', 'Foxtrot']);
    expect(container.querySelector('.ongoingLabel')?.textContent).toBe('In research queue');
    expect(container.querySelector('.ongoingCount')?.textContent).toBe('2');
  });

  it('fetches every category on mount so nothing queued can be missing', () => {
    const onResearchLoadInventory = jest.fn();
    seed({ categories: [] });

    renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />, {
      clientCallbacks: createSpiedCallbacks({ onResearchLoadInventory }),
    });

    expect(onResearchLoadInventory.mock.calls.map((c) => c[2])).toEqual([0, 1, 2, 3, 4]);
  });

  it('claims no progress and no active item', () => {
    seed({ categories: [cat(0, [], [{ inventionId: 'D1', name: 'Delta' }, { inventionId: 'D2', name: 'Echo' }])] });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    const text = container.querySelector('.ongoingBlock')!.textContent ?? '';
    expect(text).not.toMatch(/%/);
    expect(text).not.toMatch(/\bactive\b/i);
  });

  it('is absent when nothing is developing and nothing is pending', () => {
    seed({ categories: [cat(0, [{ inventionId: 'A1', name: 'Alpha' }], [])] });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).toBeNull();
  });

  it('stays on screen while the inventory refresh is loading', () => {
    seed({
      categories: [cat(0, [], [{ inventionId: 'D1', name: 'Delta' }])],
      isLoadingInventory: true,
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).toBeTruthy();
    expect(container.querySelector('.loadingList')).toBeTruthy();
  });

  it('shows an available item with a fresh queue mark, flagged as sending', () => {
    seed({
      categories: [cat(0, [{ inventionId: 'A1', name: 'Alpha' }], [])],
      pendingOps: new Map([['A1', { op: 'queue', timestamp: Date.now() }]]),
    });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingName')?.textContent).toBe('Alpha');
    expect(container.querySelector('.ongoingPending')?.textContent).toBe('sending…');
  });

  it('falls back to the invention id when the item carries an empty name', () => {
    seed({ categories: [cat(0, [], [{ inventionId: 'D1', name: '' }])] });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingName')?.textContent).toBe('D1');
  });

  it('Cancel is wired to onResearchCancelInvention with that invention id', () => {
    const onResearchCancelInvention = jest.fn();
    seed({ categories: [cat(0, [], [{ inventionId: 'D1', name: 'Delta' }])] });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />, {
      clientCallbacks: createSpiedCallbacks({ onResearchCancelInvention }),
    });

    fireEvent.click(container.querySelector('.ongoingRow button') as HTMLButtonElement);

    expect(onResearchCancelInvention).toHaveBeenCalledWith(10, 20, 'D1');
  });

  it('offers no Cancel button to a non-owner', () => {
    seed({ categories: [cat(0, [], [{ inventionId: 'D1', name: 'Delta' }])], isOwner: false });

    const { container } = renderWithProviders(<ResearchPanel buildingX={10} buildingY={20} />);

    expect(container.querySelector('.ongoingBlock')).toBeTruthy();
    expect(container.querySelector('.ongoingRow button')).toBeNull();
  });
});
