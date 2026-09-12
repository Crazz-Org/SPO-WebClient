/**
 * Films tab buttons are gated by ownership and film state (FilmsSheet.pas:175,198,199),
 * and Launch collects title, budget, months and the two flags in one validated form —
 * issue 573.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { useBuildingStore } from '../../../store/building-store';
import { PropertyGroup } from '../PropertyGroup';
import { isFilmActionOffered, parseCurrencyInput, parseFilmMonths } from '../property-utils';
import type { BuildingPropertyValue, BuildingDetailsResponse } from '@/shared/types';

function filmProps(inProd: string, filmDone: string): BuildingPropertyValue[] {
  return [
    { name: 'FilmName', value: '' },
    { name: 'FilmBudget', value: '0' },
    { name: 'FilmTime', value: '0' },
    { name: 'InProd', value: inProd },
    { name: 'FilmDone', value: filmDone },
    { name: 'AutoProd', value: 'NO' },
    { name: 'AutoRel', value: 'NO' },
  ] as BuildingPropertyValue[];
}

function seedFilmsTab(isOwner: boolean): void {
  const details: BuildingDetailsResponse = {
    buildingId: 'bld-1',
    x: 100, y: 200,
    visualClass: '9573',
    templateName: 'MovieStudio',
    buildingName: 'Studio',
    ownerName: 'TestCo',
    securityId: 'sec-1',
    canGovern: false,
    tabs: [{ id: 'films', name: 'FILMS', order: 0, icon: 'F', handlerName: 'Films' }],
    groups: { films: [] },
    timestamp: Date.now(),
  };
  useBuildingStore.getState().setDetails(details);
  useBuildingStore.setState({ currentTab: 'films', isOwner });
}

describe('Films tab visibility (issue 573)', () => {
  beforeEach(() => {
    resetStores();
  });

  it.each([
    [false, '', 'NO', false, false, false],
    [false, 'Epic', 'NO', false, false, false],
    [false, '', 'YES', false, false, false],
    [true, '', 'NO', true, false, false],
    [true, 'Epic', 'NO', false, true, false],
    [true, 'Epic', 'YES', false, true, true],
  ])(
    'owner=%s InProd=%s FilmDone=%s -> launch=%s cancel=%s release=%s',
    (isOwner, inProd, filmDone, launch, cancel, release) => {
      seedFilmsTab(isOwner as boolean);
      renderWithProviders(
        <PropertyGroup properties={filmProps(inProd as string, filmDone as string)} buildingX={100} buildingY={200} />,
      );

      const launchForm = screen.queryByRole('button', { name: 'Launch' });
      const cancelBtn = screen.queryByRole('button', { name: 'Cancel Movie' });
      const releaseBtn = screen.queryByRole('button', { name: 'Release Movie' });

      expect(!!launchForm).toBe(launch);
      expect(!!cancelBtn).toBe(cancel);
      expect(!!releaseBtn).toBe(release);
    },
  );
});

describe('Launch Movie form validation (issue 573)', () => {
  beforeEach(() => {
    resetStores();
    seedFilmsTab(true);
  });

  it.each(['5', '31'])('refuses months=%s and never calls onBuildingAction', (months) => {
    const onBuildingAction = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={filmProps('', 'NO')} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onBuildingAction }) },
    );

    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: months } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onBuildingAction).not.toHaveBeenCalled();
  });

  it('refuses a non-currency budget and never calls onBuildingAction', () => {
    const onBuildingAction = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={filmProps('', 'NO')} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onBuildingAction }) },
    );

    fireEvent.change(screen.getByDisplayValue('$10,000,000'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onBuildingAction).not.toHaveBeenCalled();
  });

  it('sends the validated params for accepted input, including title and both flags', () => {
    const onBuildingAction = jest.fn();
    renderWithProviders(
      <PropertyGroup properties={filmProps('', 'NO')} buildingX={100} buildingY={200} />,
      { clientCallbacks: createSpiedCallbacks({ onBuildingAction }) },
    );

    fireEvent.change(screen.getByDisplayValue('$10,000,000'), { target: { value: '$2,500,000' } });
    fireEvent.change(screen.getByDisplayValue('12'), { target: { value: '18' } });
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'Epic' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto Release' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto Produce' }));
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

    expect(onBuildingAction).toHaveBeenCalledWith('launchMovie', {
      filmName: 'Epic',
      budget: '2500000',
      months: '18',
      autoRel: '1',
      autoProd: '1',
    });
  });
});

describe('isFilmActionOffered / parseCurrencyInput / parseFilmMonths (issue 573)', () => {
  it('returns null for a non-film action id', () => {
    expect(isFilmActionOffered('demolish', true, new Map())).toBeNull();
  });

  it.each(['1', '0', 'YES', 'NO'])('reads FilmDone=%s for releaseMovie', (filmDone) => {
    const vm = new Map([['InProd', ''], ['FilmDone', filmDone]]);
    const expected = filmDone === '1' || filmDone === 'YES';
    expect(isFilmActionOffered('releaseMovie', true, vm)).toBe(expected);
  });

  it('parseCurrencyInput strips $ and , and rejects non-amounts', () => {
    expect(parseCurrencyInput('$10,000,000')).toBe(10000000);
    expect(parseCurrencyInput('2500000')).toBe(2500000);
    expect(parseCurrencyInput('abc')).toBeNull();
    expect(parseCurrencyInput('')).toBeNull();
  });

  it('parseFilmMonths accepts only 6..30', () => {
    expect(parseFilmMonths('6')).toBe(6);
    expect(parseFilmMonths('30')).toBe(30);
    expect(parseFilmMonths('5')).toBeNull();
    expect(parseFilmMonths('31')).toBeNull();
    expect(parseFilmMonths('x')).toBeNull();
  });
});
