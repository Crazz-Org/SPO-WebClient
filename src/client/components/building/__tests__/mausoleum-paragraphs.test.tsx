/**
 * A mausoleum's Words of Wisdom is stored `|`-separated (MausoleumSheet.pas:76,
 * :78-107 Encode/DecodeParagraph). The client must render each segment as its own
 * paragraph, with a single segment rendering exactly as before and an empty value
 * rendering as empty, never a blank paragraph — issue 575.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders, resetStores } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import { splitParagraphs } from '../property-utils';
import type { BuildingPropertyValue, BuildingDetailsResponse } from '@/shared/types';

function mausoleumProps(wordsOfWisdom: string): BuildingPropertyValue[] {
  return [
    { name: 'WordsOfWisdom', value: wordsOfWisdom },
    { name: 'OwnerName', value: 'Crazz' },
    { name: 'Transcended', value: '0' },
  ] as BuildingPropertyValue[];
}

function seedMausoleumTab(): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-1',
    x: 100, y: 200,
    visualClass: '9999',
    templateName: 'Mausoleum',
    buildingName: 'Mausoleum',
    ownerName: 'Crazz',
    securityId: 'sec-1',
    canGovern: false,
    tabs: [{ id: 'mausoleum', name: 'MEMORIAL', order: 0, icon: 'M', handlerName: 'Mausoleum' }],
    groups: { mausoleum: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ currentTab: 'mausoleum', isOwner: false });
}

describe('Mausoleum Words of Wisdom paragraphs (issue 575)', () => {
  beforeEach(() => {
    resetStores();
    seedMausoleumTab();
  });

  it('renders three paragraphs for a pipe-separated epitaph, with no | visible', () => {
    const { container } = renderWithProviders(
      <PropertyGroup properties={mausoleumProps('first|second|third')} buildingX={100} buildingY={200} />,
    );

    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(3);
    expect(Array.from(paragraphs).map((p) => p.textContent)).toEqual(['first', 'second', 'third']);
    expect(container.textContent).not.toContain('|');
  });

  it('renders a single-paragraph epitaph exactly as an ordinary text row', () => {
    const { container } = renderWithProviders(
      <PropertyGroup properties={mausoleumProps('only one')} buildingX={100} buildingY={200} />,
    );

    expect(container.querySelectorAll('p').length).toBe(0);
    expect(screen.getByText('only one')).toBeTruthy();
    expect(screen.getByText('Words of Wisdom')).toBeTruthy();
  });

  it('renders an empty epitaph as empty, not a blank paragraph', () => {
    renderWithProviders(
      <PropertyGroup properties={mausoleumProps('')} buildingX={100} buildingY={200} />,
    );

    expect(screen.queryAllByText('|').length).toBe(0);
    expect(document.querySelector('p')).toBeNull();
    const cell = screen.getByTestId('words-of-wisdom');
    expect(cell.textContent).toBe('');
    expect(screen.getByText('Words of Wisdom')).toBeTruthy();
  });
});

describe('splitParagraphs (issue 575)', () => {
  it('drops empty segments and splits on |', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('a')).toEqual(['a']);
    expect(splitParagraphs('a|b|c')).toEqual(['a', 'b', 'c']);
    expect(splitParagraphs('a||b')).toEqual(['a', 'b']);
  });
});
