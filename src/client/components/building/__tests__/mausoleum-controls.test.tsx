/**
 * The mausoleum owner edits the epitaph and saves it (stored `|`-joined, per
 * MausoleumSheet.pas EncodeParagraph :78-90); a visitor sees the read-only
 * paragraph view from #575. The owner also sees a Cancel transcendence button
 * while `Transcended !== '1'` (MausoleumSheet.pas:145), gated by an explicit
 * confirmation naming the deletion (TranscendBlock.pas:221-234) — issue 576.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { useUiStore } from '../../../store/ui-store';
import { PropertyGroup } from '../PropertyGroup';
import { joinParagraphs } from '../property-utils';
import type { BuildingPropertyValue, BuildingDetailsResponse } from '@/shared/types';

function mausoleumProps(wordsOfWisdom: string, transcended: string): BuildingPropertyValue[] {
  return [
    { name: 'WordsOfWisdom', value: wordsOfWisdom },
    { name: 'OwnerName', value: 'Crazz' },
    { name: 'Transcended', value: transcended },
  ] as BuildingPropertyValue[];
}

function seedMausoleumTab(isOwner: boolean): void {
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
  useBuildingStore.setState({ currentTab: 'mausoleum', isOwner });
}

describe('Mausoleum epitaph editor (issue 576)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('offers the editor to the owner only', () => {
    seedMausoleumTab(true);
    renderWithProviders(
      <PropertyGroup properties={mausoleumProps('a|b|c', '0')} buildingX={100} buildingY={200} />,
    );
    expect(screen.getByRole('textbox', { name: 'Words of Wisdom' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save epitaph' })).toBeTruthy();
  });

  it('renders the visitor read-only, as before', () => {
    seedMausoleumTab(false);
    const { container } = renderWithProviders(
      <PropertyGroup properties={mausoleumProps('a|b|c', '0')} buildingX={100} buildingY={200} />,
    );
    expect(screen.queryByRole('textbox', { name: 'Words of Wisdom' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save epitaph' })).toBeNull();
    expect(container.querySelectorAll('p').length).toBe(3);
  });

  it('submits the typed text pipe-joined', () => {
    seedMausoleumTab(true);
    const onSetBuildingProperty = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={mausoleumProps('old', '0')} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
    );

    const textarea = screen.getByRole('textbox', { name: 'Words of Wisdom' });
    fireEvent.change(textarea, { target: { value: 'first\nsecond\n\nthird' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save epitaph' }));

    expect(onSetBuildingProperty).toHaveBeenCalledTimes(1);
    expect(onSetBuildingProperty).toHaveBeenCalledWith(100, 200, 'RDOSetWordsOfWisdom', 'first|second|third', undefined);
  });

  it('re-syncs the textarea when the server value changes', () => {
    seedMausoleumTab(true);
    const { rerender } = renderWithProviders(
      <PropertyGroup properties={mausoleumProps('old', '0')} buildingX={100} buildingY={200} />,
    );
    expect((screen.getByRole('textbox', { name: 'Words of Wisdom' }) as HTMLTextAreaElement).value).toBe('old');

    rerender(
      <PropertyGroup properties={mausoleumProps('a|b', '0')} buildingX={100} buildingY={200} />,
    );
    expect((screen.getByRole('textbox', { name: 'Words of Wisdom' }) as HTMLTextAreaElement).value).toBe('a\nb');
  });

  describe.each([
    [true, '0', true],
    [true, '1', false],
    [false, '0', false],
    [false, '1', false],
  ])('owner=%s Transcended=%s', (isOwner, transcended, expectCancel) => {
    it(`cancel button ${expectCancel ? 'is' : 'is not'} offered`, () => {
      seedMausoleumTab(isOwner as boolean);
      renderWithProviders(
        <PropertyGroup properties={mausoleumProps('a', transcended as string)} buildingX={100} buildingY={200} />,
      );
      const btn = screen.queryByRole('button', { name: 'Cancel transcendence' });
      expect(!!btn).toBe(expectCancel);
    });
  });

  it('asks for confirmation naming the deletion before cancelling', () => {
    seedMausoleumTab(true);
    const onSetBuildingProperty = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={mausoleumProps('a', '0')} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel transcendence' }));
    expect(onSetBuildingProperty).not.toHaveBeenCalled();

    const ui = useUiStore.getState();
    expect(ui.modal).toBe('confirm');
    expect(ui.confirmPayload?.options?.kind).toBe('destructive');
    expect(ui.confirmPayload?.message).toMatch(/deleted/i);

    act(() => { useUiStore.getState().confirmPayload?.onConfirm(); });
    expect(onSetBuildingProperty).toHaveBeenCalledTimes(1);
    expect(onSetBuildingProperty).toHaveBeenCalledWith(100, 200, 'RDOCacncelTransc', '0', undefined);
  });

  it('cancelling the dialog sends nothing', () => {
    seedMausoleumTab(true);
    const onSetBuildingProperty = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={mausoleumProps('a', '0')} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onSetBuildingProperty }) },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel transcendence' }));
    act(() => { useUiStore.getState().closeModal(); });

    expect(onSetBuildingProperty).not.toHaveBeenCalled();
  });
});

describe('joinParagraphs (issue 576)', () => {
  it('joins non-empty lines with |, dropping empty lines', () => {
    expect(joinParagraphs('')).toBe('');
    expect(joinParagraphs('a')).toBe('a');
    expect(joinParagraphs('a\nb')).toBe('a|b');
    expect(joinParagraphs('a\n\nb\r\n')).toBe('a|b');
  });
});
