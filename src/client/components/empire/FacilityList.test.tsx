/**
 * H6 — the grouped My facilities list: Losing money / Status unknown /
 * Operating, honest about what has never been loaded.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders, createSpiedCallbacks } from '../../__tests__/setup/render-helpers';
import { useUiStore } from '../../store/ui-store';
import { useMapStore } from '../../store/map-store';
import { useEmpireStore } from '../../store/empire-store';
import { FacilityList } from './FacilityList';
import type { FavoritesItem, MapBuilding } from '@/shared/types';
import type { MinimapRendererAPI } from '../../ui/minimap-colormap';

// At the root of the tree the Location IS the id — that is what a delete or a
// rename addresses (`TFavorites.LocateItem`, `Kernel/Favorites.pas:312-334`).
const fav = (id: number, name: string, x: number, y: number): FavoritesItem =>
  ({ id, name, x, y, path: String(id) } as FavoritesItem);
/** A link nested under `parentPath` — its Location is `parentPath/id`, as the server serves it. */
const nestedFav = (id: number, name: string, x: number, y: number, parentPath: string): FavoritesItem =>
  ({ id, name, x, y, path: `${parentPath}/${id}` } as FavoritesItem);
const folderItem = (id: number, name: string, path: string, children: FavoritesItem[] = []): FavoritesItem =>
  ({ id, name, x: 0, y: 0, path, isFolder: true, children } as FavoritesItem);
const bld = (x: number, y: number, alert: boolean): MapBuilding =>
  ({ visualClass: '100', tycoonId: 1, options: 0, x, y, level: 0, alert, attack: 0 } as unknown as MapBuilding);

function seedSource(buildings: MapBuilding[]): void {
  useMapStore.getState().setSource({
    getAllBuildings: () => buildings,
  } as unknown as MinimapRendererAPI);
}

describe('FacilityList (H6)', () => {
  beforeEach(() => {
    useUiStore.getState().clearSurfaces();
    useUiStore.setState({ confirmPayload: null, promptPayload: null });
    useMapStore.getState().setSource(null);
    useEmpireStore.getState().reset();
  });

  it('groups favorites into the three honest buckets', () => {
    seedSource([bld(1, 1, true), bld(2, 2, false)]);
    renderWithProviders(
      <FacilityList facilities={[fav(1, 'Mill', 1, 1), fav(2, 'Farm', 2, 2), fav(3, 'Dome', 9, 9)]} />,
    );
    expect(screen.getByText('Losing money (1)')).toBeTruthy();
    expect(screen.getByText('Status unknown')).toBeTruthy();
    expect(screen.getByText('Not visited yet — tap to check.')).toBeTruthy();
    expect(screen.getByText('Operating')).toBeTruthy();
    expect(screen.getByText('Mill')).toBeTruthy();
    expect(screen.getByText('Dome')).toBeTruthy();
  });

  it('states plainly when no loaded facility is losing money', () => {
    seedSource([bld(2, 2, false)]);
    renderWithProviders(<FacilityList facilities={[fav(2, 'Farm', 2, 2)]} />);
    expect(screen.getByText("No facility is losing money in the areas you've visited.")).toBeTruthy();
  });

  it('without a renderer source, everything is honestly unknown', () => {
    renderWithProviders(<FacilityList facilities={[fav(1, 'Mill', 1, 1)]} />);
    expect(screen.getByText('Status unknown')).toBeTruthy();
  });

  it('a row still pans the map and opens the inspector', () => {
    seedSource([bld(1, 1, true)]);
    const onNavigateToBuilding = jest.fn();
    renderWithProviders(<FacilityList facilities={[fav(1, 'Mill', 1, 1)]} />, {
      clientCallbacks: createSpiedCallbacks({ onNavigateToBuilding }),
    });
    // `^Mill` — the row's own button, not the "Rename Mill" / "Remove Mill"
    // actions that now sit beside it.
    fireEvent.click(screen.getByRole('button', { name: /^Mill/ }));
    expect(onNavigateToBuilding).toHaveBeenCalledWith(1, 1);
    expect(useUiStore.getState().rightPanel).toBe('building');
  });

  it('keeps the empty state when there are no favorites at all', () => {
    renderWithProviders(<FacilityList facilities={[]} />);
    expect(screen.getByText('No facilities found')).toBeTruthy();
  });

  // ── the write half: remove and rename address the item by its Location ────

  it('removes by Location, and says "remove from list" rather than "delete"', () => {
    const onRemoveFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[fav(4210, 'Mill', 1, 1)]} />, {
      clientCallbacks: createSpiedCallbacks({ onRemoveFavorite }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Mill from list' }));

    expect(onRemoveFavorite).toHaveBeenCalledWith('4210', 'Mill');
  });

  it('renames on Enter, sending the Location and the new name', () => {
    const onRenameFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[fav(4210, 'Mill', 1, 1)]} />, {
      clientCallbacks: createSpiedCallbacks({ onRenameFavorite }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Mill' }));
    const input = screen.getByRole('textbox', { name: 'Rename Mill' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Moulin du Nord' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameFavorite).toHaveBeenCalledWith('4210', 'Moulin du Nord');
  });

  it('stops the input at the 50 characters the server would keep', () => {
    renderWithProviders(<FacilityList facilities={[fav(4210, 'Mill', 1, 1)]} />, {
      clientCallbacks: createSpiedCallbacks({}),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Mill' }));

    expect(screen.getByRole('textbox', { name: 'Rename Mill' }).getAttribute('maxlength')).toBe('50');
  });

  it('Escape cancels without sending anything', () => {
    const onRenameFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[fav(4210, 'Mill', 1, 1)]} />, {
      clientCallbacks: createSpiedCallbacks({ onRenameFavorite }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Mill' }));
    const input = screen.getByRole('textbox', { name: 'Rename Mill' });
    fireEvent.change(input, { target: { value: 'Moulin du Nord' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameFavorite).not.toHaveBeenCalled();
    expect(screen.getByText('Mill')).toBeTruthy();
  });

  it('an unchanged or emptied name is not a rename — no round trip is spent', () => {
    const onRenameFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[fav(4210, 'Mill', 1, 1)]} />, {
      clientCallbacks: createSpiedCallbacks({ onRenameFavorite }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Mill' }));
    const input = screen.getByRole('textbox', { name: 'Rename Mill' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameFavorite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Mill' }));
    const again = screen.getByRole('textbox', { name: 'Rename Mill' });
    fireEvent.change(again, { target: { value: '   ' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(onRenameFavorite).not.toHaveBeenCalled();
  });

  it('commits the rename when the input loses focus', () => {
    const onRenameFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[fav(4210, 'Mill', 1, 1)]} />, {
      clientCallbacks: createSpiedCallbacks({ onRenameFavorite }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Mill' }));
    const input = screen.getByRole('textbox', { name: 'Rename Mill' });
    fireEvent.change(input, { target: { value: 'Moulin' } });
    fireEvent.blur(input);

    expect(onRenameFavorite).toHaveBeenCalledWith('4210', 'Moulin');
  });

  // ── folders ────────────────────────────────────────────────────────────

  it('always shows the New Folder button, even in the empty state', () => {
    renderWithProviders(<FacilityList facilities={[]} />);
    expect(screen.getByRole('button', { name: 'New folder' })).toBeTruthy();
    expect(screen.getByText('No facilities found')).toBeTruthy();
  });

  it('New Folder opens a root-level prompt that calls onCreateFavoriteFolder', () => {
    const onCreateFavoriteFolder = jest.fn();
    renderWithProviders(<FacilityList facilities={[]} />, {
      clientCallbacks: createSpiedCallbacks({ onCreateFavoriteFolder }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const promptPayload = useUiStore.getState().promptPayload;
    expect(promptPayload?.title).toBe('New folder');

    promptPayload?.onSubmit('Farms');
    expect(onCreateFavoriteFolder).toHaveBeenCalledWith('', 'Farms');
  });

  it('renders a Folders section with indentation and item counts', () => {
    const nested = nestedFav(11, 'Nested', 5, 5, '10');
    useEmpireStore.getState().setFacilities([
      folderItem(10, 'Top', '10', [
        nested,
        folderItem(12, 'Sub', '10/12'),
      ]),
    ]);
    renderWithProviders(<FacilityList facilities={[nested]} />);

    expect(screen.getByText('Folders')).toBeTruthy();
    expect(screen.getByText('📁 Top')).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.getByText('📁 Sub')).toBeTruthy();
    expect(screen.getByText('0 items')).toBeTruthy();
  });

  it('removes an empty folder directly, without confirming', () => {
    useEmpireStore.getState().setFacilities([folderItem(10, 'Empty', '10')]);
    const onRemoveFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[]} />, {
      clientCallbacks: createSpiedCallbacks({ onRemoveFavorite }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Empty' }));

    expect(onRemoveFavorite).toHaveBeenCalledWith('10', 'Empty');
    expect(useUiStore.getState().confirmPayload).toBeNull();
  });

  it('confirms before removing a non-empty folder', () => {
    const nested = nestedFav(11, 'Mill', 5, 5, '10');
    useEmpireStore.getState().setFacilities([
      folderItem(10, 'Farms', '10', [nested]),
    ]);
    const onRemoveFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[nested]} />, {
      clientCallbacks: createSpiedCallbacks({ onRemoveFavorite }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Farms' }));

    expect(onRemoveFavorite).not.toHaveBeenCalled();
    const payload = useUiStore.getState().confirmPayload;
    expect(payload?.title).toBe('Remove folder');
    payload?.onConfirm();
    expect(onRemoveFavorite).toHaveBeenCalledWith('10', 'Farms');
  });

  it('renames a folder like a link row', () => {
    useEmpireStore.getState().setFacilities([folderItem(10, 'Farms', '10')]);
    const onRenameFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[]} />, {
      clientCallbacks: createSpiedCallbacks({ onRenameFavorite }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Farms' }));
    const input = screen.getByRole('textbox', { name: 'Rename Farms' });
    fireEvent.change(input, { target: { value: 'Ferme' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameFavorite).toHaveBeenCalledWith('10', 'Ferme');
  });

  it('offers a Move to… select once folders exist, omitting the link\'s current parent', () => {
    const nested = nestedFav(11, 'Mill', 5, 5, '10');
    useEmpireStore.getState().setFacilities([
      folderItem(10, 'Farms', '10', [nested]),
      folderItem(20, 'Other', '20'),
    ]);
    const onMoveFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[nested]} />, {
      clientCallbacks: createSpiedCallbacks({ onMoveFavorite }),
    });

    const select = screen.getByRole('combobox', { name: 'Move Mill to…' }) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.value);
    expect(optionLabels).not.toContain('10');
    expect(optionLabels).toContain('20');

    fireEvent.change(select, { target: { value: '20' } });
    expect(onMoveFavorite).toHaveBeenCalledWith('10/11', '20', 'Mill');
  });

  it('Root option maps to the empty destination path', () => {
    const nested = nestedFav(11, 'Mill', 5, 5, '10');
    useEmpireStore.getState().setFacilities([folderItem(10, 'Farms', '10', [nested])]);
    const onMoveFavorite = jest.fn();
    renderWithProviders(<FacilityList facilities={[nested]} />, {
      clientCallbacks: createSpiedCallbacks({ onMoveFavorite }),
    });

    const select = screen.getByRole('combobox', { name: 'Move Mill to…' });
    fireEvent.change(select, { target: { value: '/' } });

    expect(onMoveFavorite).toHaveBeenCalledWith('10/11', '', 'Mill');
  });

  it('shows no Move to… select when there are no folders', () => {
    renderWithProviders(<FacilityList facilities={[fav(1, 'Mill', 1, 1)]} />);
    expect(screen.queryByRole('combobox', { name: /Move .* to…/ })).toBeNull();
  });

  it('shows which folder a link sits in', () => {
    const nested = nestedFav(11, 'Mill', 5, 5, '10');
    useEmpireStore.getState().setFacilities([
      folderItem(10, 'Farms', '10', [nested]),
    ]);
    renderWithProviders(<FacilityList facilities={[nested]} />);
    expect(screen.getByText('5, 5 · in Farms')).toBeTruthy();
  });

  // ── batch selection: checkboxes, Remove selected, Delete/Escape ─────────

  it('selecting two rows and clicking Remove selected raises one confirmation for the batch', () => {
    const onRemoveFavorites = jest.fn();
    renderWithProviders(
      <FacilityList facilities={[fav(1, 'Mill', 1, 1), fav(2, 'Farm', 2, 2)]} />,
      { clientCallbacks: createSpiedCallbacks({ onRemoveFavorites }) },
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Mill' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Farm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected (2)' }));

    expect(onRemoveFavorites).not.toHaveBeenCalled();
    const payload = useUiStore.getState().confirmPayload;
    expect(payload?.title).toBe('Remove from list');

    act(() => payload?.onConfirm());
    expect(onRemoveFavorites).toHaveBeenCalledTimes(1);
    expect(onRemoveFavorites).toHaveBeenCalledWith([
      { path: '1', name: 'Mill' }, { path: '2', name: 'Farm' },
    ]);
  });

  it('the Delete key raises the same single confirmation for the selection', () => {
    const onRemoveFavorites = jest.fn();
    renderWithProviders(
      <FacilityList facilities={[fav(1, 'Mill', 1, 1)]} />,
      { clientCallbacks: createSpiedCallbacks({ onRemoveFavorites }) },
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Mill' }));
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Select Mill' }), { key: 'Delete' });

    const payload = useUiStore.getState().confirmPayload;
    expect(payload?.title).toBe('Remove from list');
    act(() => payload?.onConfirm());
    expect(onRemoveFavorites).toHaveBeenCalledTimes(1);
  });

  it('Escape clears the selection and raises no confirmation', () => {
    const onRemoveFavorites = jest.fn();
    renderWithProviders(
      <FacilityList facilities={[fav(1, 'Mill', 1, 1)]} />,
      { clientCallbacks: createSpiedCallbacks({ onRemoveFavorites }) },
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Select Mill' });
    fireEvent.click(checkbox);
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.keyDown(checkbox, { key: 'Escape' });

    expect(screen.queryByText('1 selected')).toBeNull();
    expect(useUiStore.getState().confirmPayload).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'Select Mill' }) as HTMLInputElement).checked).toBe(false);
  });
});
