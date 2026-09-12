/**
 * Tests for ui-store — build menu state.
 */

import { useUiStore } from './ui-store';
import { useBuildingStore } from './building-store';

describe('ui-store build menu state', () => {
  beforeEach(() => {
    // Reset build menu state
    useUiStore.getState().clearBuildMenuData();
  });

  it('should have correct initial build menu state', () => {
    const state = useUiStore.getState();
    expect(state.buildMenuCategories).toEqual([]);
    expect(state.buildMenuFacilities).toEqual([]);
  });

  it('setBuildMenuCategories should set categories', () => {
    const categories = [
      { kind: 1, kindName: 'Residential', cluster: 'General', tycoonLevel: 0 },
      { kind: 2, kindName: 'Commercial', cluster: 'General', tycoonLevel: 1 },
    ];
    useUiStore.getState().setBuildMenuCategories(categories as never[]);
    expect(useUiStore.getState().buildMenuCategories).toEqual(categories);
  });

  it('setBuildMenuFacilities should set facilities', () => {
    const facilities = [
      { facilityClass: 'house1', name: 'Small House', cost: 1000, area: 4, available: true, visualClassId: 100, description: 'A small house' },
    ];
    useUiStore.getState().setBuildMenuFacilities(facilities as never[]);
    expect(useUiStore.getState().buildMenuFacilities).toEqual(facilities);
  });

  it('clearBuildMenuData should reset both arrays', () => {
    useUiStore.getState().setBuildMenuCategories([{ kind: 1 }] as never[]);
    useUiStore.getState().setBuildMenuFacilities([{ name: 'test' }] as never[]);

    useUiStore.getState().clearBuildMenuData();

    const state = useUiStore.getState();
    expect(state.buildMenuCategories).toEqual([]);
    expect(state.buildMenuFacilities).toEqual([]);
  });
});

describe('ui-store existing state', () => {
  it('should preserve existing modal behavior', () => {
    useUiStore.getState().openModal('buildMenu');
    expect(useUiStore.getState().modal).toBe('buildMenu');

    useUiStore.getState().closeModal();
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('should preserve existing panel behavior', () => {
    useUiStore.getState().openRightPanel('building');
    expect(useUiStore.getState().rightPanel).toBe('building');

    useUiStore.getState().closeRightPanel();
    expect(useUiStore.getState().rightPanel).toBeNull();
  });

  it('should toggle left panel with facilities type', () => {
    useUiStore.getState().toggleLeftPanel('facilities');
    expect(useUiStore.getState().leftPanel).toBe('facilities');

    useUiStore.getState().toggleLeftPanel('facilities');
    expect(useUiStore.getState().leftPanel).toBeNull();
  });

  it('should switch left panel between empire and facilities', () => {
    useUiStore.getState().openLeftPanel('empire');
    expect(useUiStore.getState().leftPanel).toBe('empire');

    useUiStore.getState().openLeftPanel('facilities');
    expect(useUiStore.getState().leftPanel).toBe('facilities');
  });

  it('should open buildingInspector modal', () => {
    useUiStore.getState().openModal('buildingInspector');
    expect(useUiStore.getState().modal).toBe('buildingInspector');

    useUiStore.getState().closeModal();
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('should close right panel when opening buildingInspector modal', () => {
    useUiStore.getState().openRightPanel('building');
    expect(useUiStore.getState().rightPanel).toBe('building');

    useUiStore.getState().openModal('buildingInspector');
    expect(useUiStore.getState().modal).toBe('buildingInspector');
    expect(useUiStore.getState().rightPanel).toBeNull();
  });

  it('dismissTopmost with buildingInspector modal should clear building focus', () => {
    // Set some building focus state
    useBuildingStore.getState().setFocus({
      buildingName: 'National Capitol',
      ownerName: 'Test',
      x: 100,
      y: 200,
    } as never);
    useUiStore.getState().openModal('buildingInspector');

    useUiStore.getState().dismissTopmost();

    expect(useUiStore.getState().modal).toBeNull();
    expect(useBuildingStore.getState().focusedBuilding).toBeNull();
  });

  it('requestPrompt should set modal and promptPayload', () => {
    const onSubmit = jest.fn();
    useUiStore.getState().requestPrompt('Test Title', 'Test message', onSubmit, {
      placeholder: 'Enter name',
      defaultValue: 'default',
    });

    const state = useUiStore.getState();
    expect(state.modal).toBe('prompt');
    expect(state.promptPayload).toEqual({
      title: 'Test Title',
      message: 'Test message',
      placeholder: 'Enter name',
      defaultValue: 'default',
      onSubmit,
    });
  });

  it('closeModal should clear promptPayload', () => {
    const onSubmit = jest.fn();
    useUiStore.getState().requestPrompt('Title', 'Msg', onSubmit);
    expect(useUiStore.getState().promptPayload).not.toBeNull();

    useUiStore.getState().closeModal();
    expect(useUiStore.getState().modal).toBeNull();
    expect(useUiStore.getState().promptPayload).toBeNull();
  });

  it('should preserve dismissTopmost priority order', () => {
    useUiStore.getState().openRightPanel('building');
    useUiStore.getState().openModal('settings');
    useUiStore.getState().openCommandPalette();

    // Topmost: command palette
    useUiStore.getState().dismissTopmost();
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    expect(useUiStore.getState().modal).toBe('settings');

    // Next: modal
    useUiStore.getState().dismissTopmost();
    expect(useUiStore.getState().modal).toBeNull();
    expect(useUiStore.getState().rightPanel).toBe('building');

    // Next: right panel
    useUiStore.getState().dismissTopmost();
    expect(useUiStore.getState().rightPanel).toBeNull();
  });
});

/**
 * Stacked prompts — the appoint flow.
 *
 * `modal` holds a single value, so raising the name prompt used to replace the
 * civic inspector outright: it unmounted, and closing the prompt left nothing
 * behind it. Naming three ministers meant three trips back through the map.
 */
describe('ui-store stacked modals', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, modalBeneath: null, confirmPayload: null, promptPayload: null });
  });

  it('remembers the modal a prompt was raised over', () => {
    useUiStore.getState().openModal('buildingInspector');
    useUiStore.getState().requestPrompt('Elect Mayor', 'Name?', () => {});

    expect(useUiStore.getState().modal).toBe('prompt');
    expect(useUiStore.getState().modalBeneath).toBe('buildingInspector');
  });

  it('returns to the inspector when the prompt closes', () => {
    useUiStore.getState().openModal('buildingInspector');
    useUiStore.getState().requestPrompt('Elect Mayor', 'Name?', () => {});
    useUiStore.getState().closeModal();

    expect(useUiStore.getState().modal).toBe('buildingInspector');
    expect(useUiStore.getState().modalBeneath).toBeNull();
    expect(useUiStore.getState().promptPayload).toBeNull();
  });

  it('does the same for a confirm', () => {
    useUiStore.getState().openModal('buildingInspector');
    useUiStore.getState().requestConfirm('Depose', 'Sure?', () => {});
    expect(useUiStore.getState().modalBeneath).toBe('buildingInspector');
    useUiStore.getState().closeModal();
    expect(useUiStore.getState().modal).toBe('buildingInspector');
  });

  it('closes to nothing when the prompt was not raised over anything', () => {
    useUiStore.getState().requestPrompt('Standalone', 'Name?', () => {});
    expect(useUiStore.getState().modalBeneath).toBeNull();
    useUiStore.getState().closeModal();
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('does not stack a prompt on a prompt', () => {
    // A second prompt must not bury the first one's beneath value, or closing
    // would strand the player one layer down.
    useUiStore.getState().openModal('buildingInspector');
    useUiStore.getState().requestPrompt('First', 'a?', () => {});
    useUiStore.getState().requestPrompt('Second', 'b?', () => {});

    expect(useUiStore.getState().modalBeneath).toBe('buildingInspector');
    useUiStore.getState().closeModal();
    expect(useUiStore.getState().modal).toBe('buildingInspector');
  });

  it('leaves an ordinary modal unstacked', () => {
    useUiStore.getState().openModal('settings');
    expect(useUiStore.getState().modalBeneath).toBeNull();
    useUiStore.getState().closeModal();
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('dismisses one layer at a time with Escape', () => {
    useUiStore.getState().openModal('buildingInspector');
    useUiStore.getState().requestPrompt('Elect Mayor', 'Name?', () => {});

    useUiStore.getState().dismissTopmost();
    // Back to the inspector, not out of it — and the focus survives.
    expect(useUiStore.getState().modal).toBe('buildingInspector');

    useUiStore.getState().dismissTopmost();
    expect(useUiStore.getState().modal).toBeNull();
  });
});

describe('ui-store requestConfirm options', () => {
  // The unit project runs under node: give the store the tiny sessionStorage it reads.
  const mem = new Map<string, string>();
  beforeAll(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => { mem.set(k, v); },
        removeItem: (k: string) => { mem.delete(k); },
        clear: () => { mem.clear(); },
      },
    });
  });
  afterAll(() => {
    // @ts-expect-error — removing the stub we installed
    delete globalThis.sessionStorage;
  });
  beforeEach(() => {
    mem.clear();
    useUiStore.setState({ modal: null, modalBeneath: null, confirmPayload: null });
  });

  it('carries the options into the payload', () => {
    const onConfirm = jest.fn();
    useUiStore.getState().requestConfirm('Demolish', 'Sure?', onConfirm, { kind: 'destructive', typeToConfirm: 'CONFIRM', confirmLabel: 'Demolish' });
    const s = useUiStore.getState();
    expect(s.modal).toBe('confirm');
    expect(s.confirmPayload?.options).toEqual({ kind: 'destructive', typeToConfirm: 'CONFIRM', confirmLabel: 'Demolish' });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('skips the dialog and confirms at once when the player opted out for the session', () => {
    sessionStorage.setItem('spo.dialog.dontAsk.build', '1');
    const onConfirm = jest.fn();
    useUiStore.getState().requestConfirm('Build?', 'cost', onConfirm, { kind: 'spend', dontAskAgainKey: 'build' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().modal).toBeNull();
  });

  it('still asks when the opt-out key is not set', () => {
    const onConfirm = jest.fn();
    useUiStore.getState().requestConfirm('Build?', 'cost', onConfirm, { kind: 'spend', dontAskAgainKey: 'build' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(useUiStore.getState().modal).toBe('confirm');
  });
});

describe('ui-store surface stack', () => {
  beforeEach(() => {
    useUiStore.setState({ modal: null, modalBeneath: null, confirmPayload: null, promptPayload: null, commandPaletteOpen: false, minimapFullscreen: false });
    useUiStore.getState().clearSurfaces();
  });

  it('push never replaces: the building stays under the supplier search', () => {
    const s = useUiStore.getState();
    s.setRootSurface({ kind: 'building' });
    s.pushSurface({ kind: 'search', params: { fluid: 'Cotton' } });
    expect(useUiStore.getState().stack.map((x) => x.kind)).toEqual(['building', 'search']);
    // legacy view follows the top
    expect(useUiStore.getState().rightPanel).toBe('search');
    s.popSurface();
    expect(useUiStore.getState().stack.map((x) => x.kind)).toEqual(['building']);
    expect(useUiStore.getState().rightPanel).toBe('building');
  });

  it('pushing the same surface twice is a no-op', () => {
    const s = useUiStore.getState();
    s.pushSurface({ kind: 'mail' });
    s.pushSurface({ kind: 'mail' });
    expect(useUiStore.getState().stack).toHaveLength(1);
  });

  it('popTo returns to a chip; replaceTop keeps the depth', () => {
    const s = useUiStore.getState();
    s.setRootSurface({ kind: 'empire' });
    s.pushSurface({ kind: 'building' });
    s.pushSurface({ kind: 'search' });
    s.popToSurface(0);
    expect(useUiStore.getState().stack.map((x) => x.kind)).toEqual(['empire']);
    expect(useUiStore.getState().leftPanel).toBe('empire');
    expect(useUiStore.getState().rightPanel).toBeNull();
    s.replaceTopSurface({ kind: 'facilities' });
    expect(useUiStore.getState().stack.map((x) => x.kind)).toEqual(['facilities']);
  });

  it('legacy open/toggle/close map onto the stack', () => {
    const s = useUiStore.getState();
    s.openRightPanel('mail');
    expect(useUiStore.getState().stack).toEqual([{ kind: 'mail' }]);
    s.toggleRightPanel('mail');
    expect(useUiStore.getState().stack).toEqual([]);
    s.toggleLeftPanel('overlays');
    expect(useUiStore.getState().leftPanel).toBe('overlays');
    s.openRightPanel('building');
    // one sheet: opening a right content replaces the left one (option C, one surface)
    expect(useUiStore.getState().leftPanel).toBeNull();
    expect(useUiStore.getState().rightPanel).toBe('building');
    s.closeAllPanels();
    expect(useUiStore.getState().stack).toEqual([]);
  });

  it('Escape unstacks one surface at a time', () => {
    const s = useUiStore.getState();
    s.setRootSurface({ kind: 'building' });
    s.pushSurface({ kind: 'search' });
    s.dismissTopmost();
    expect(useUiStore.getState().stack.map((x) => x.kind)).toEqual(['building']);
    s.dismissTopmost();
    expect(useUiStore.getState().stack).toEqual([]);
  });

  it('the civic modal still clears the sheet (until socle-3c folds it in)', () => {
    const s = useUiStore.getState();
    s.setRootSurface({ kind: 'mail' });
    s.openModal('buildingInspector');
    expect(useUiStore.getState().stack).toEqual([]);
    useUiStore.getState().closeModal();
  });

  it('pinned is plain state', () => {
    useUiStore.getState().setPinned(true);
    expect(useUiStore.getState().pinned).toBe(true);
    useUiStore.getState().setPinned(false);
  });
});

describe('ui-store map context menu', () => {
  beforeEach(() => {
    useUiStore.getState().closeMapContextMenu();
  });

  it('starts closed', () => {
    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });

  it('openMapContextMenu stores the tile and closeMapContextMenu clears it', () => {
    useUiStore.getState().openMapContextMenu({ clientX: 100, clientY: 50, tileX: 10, tileY: 5, layer: 'building', visualClass: '100' });
    expect(useUiStore.getState().mapContextMenu).toEqual({ clientX: 100, clientY: 50, tileX: 10, tileY: 5, layer: 'building', visualClass: '100' });

    useUiStore.getState().closeMapContextMenu();
    expect(useUiStore.getState().mapContextMenu).toBeNull();
  });

  it('dismissTopmost closes the menu first and leaves an open surface stack untouched', () => {
    useUiStore.getState().setRootSurface({ kind: 'mail' });
    useUiStore.getState().openMapContextMenu({ clientX: 0, clientY: 0, tileX: 1, tileY: 1, layer: 'terrain' });

    useUiStore.getState().dismissTopmost();
    expect(useUiStore.getState().mapContextMenu).toBeNull();
    expect(useUiStore.getState().stack.map((s) => s.kind)).toEqual(['mail']);

    useUiStore.getState().dismissTopmost();
    expect(useUiStore.getState().stack).toEqual([]);
  });
});
