/**
 * WorkforceTable — the salary slider round-trip.
 *
 * What these tests pin down, in order of how much a regression would cost:
 *
 *  1. one release, one request. `RDOSetSalaries` rewrites the whole triplet, so
 *     an emitter that fires while the thumb moves is a burst of triplet writes.
 *  2. the pending key the card subscribes to is the key `setBuildingProperty`
 *     registers. They are built from different call sites; if they drift the
 *     indicator stays dark and the lock never engages.
 *  3. the lock holds every slider until the answer AND the refreshed values are
 *     in — and always releases, even when the refresh never lands.
 *  4. the value shown afterwards is the server's, not the one released.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithProviders, resetStores, createSpiedCallbacks } from '../../../__tests__/setup/render-helpers';
import { WorkforceTable } from '../WorkforceTable';
import { buildSalaryParams, pendingKeyFor, resolveRdoCommand } from '../property-utils';
import { useBuildingStore } from '../../../store/building-store';
import type { BuildingPropertyValue, BuildingDetailsResponse, WorkerCount } from '@/shared/types';
import type { RdoCommandMapping } from '@/shared/building-details';

const RDO_COMMANDS: Record<string, RdoCommandMapping> = {
  Salaries: { command: 'RDOSetSalaries', allSalaries: true },
};

/** Executives idle, Professionals 14/14, Workers 69/70 — the panel screenshot. */
const BASE: Record<string, string> = {
  Workers0: '0', WorkersMax0: '0', WorkersCap0: '0', WorkersK0: '0',
  WorkForcePrice0: '0', Salaries0: '100', MinSalaries0: '0',
  Workers1: '14', WorkersMax1: '14', WorkersCap1: '14', WorkersK1: '50',
  WorkForcePrice1: '8', Salaries1: '100', MinSalaries1: '90',
  Workers2: '69', WorkersMax2: '70', WorkersCap2: '70', WorkersK2: '50',
  WorkForcePrice2: '2', Salaries2: '100', MinSalaries2: '0',
};

function props(overrides: Record<string, string> = {}): BuildingPropertyValue[] {
  return Object.entries({ ...BASE, ...overrides })
    .map(([name, value]) => ({ name, value }) as BuildingPropertyValue);
}

/** The key setBuildingProperty registers for this edit — see buildSalaryParams. */
function keyFor(properties: BuildingPropertyValue[], index: number, value: number): string {
  const resolved = resolveRdoCommand(`Salaries${index}`, RDO_COMMANDS);
  return pendingKeyFor(resolved.command, buildSalaryParams(properties, resolved.params, value));
}

function details(): BuildingDetailsResponse {
  return {
    buildingId: '1',
    x: 10,
    y: 20,
    visualClass: '5',
    templateName: 'Factory',
    buildingName: 'Plant',
    ownerName: 'SPO_test3',
    securityId: '1000',
    canGovern: true,
    tabs: [],
    groups: {},
    timestamp: 1,
  };
}

/**
 * Render with a callback chain that behaves like the real one: the emitter
 * registers a pending update under the key it derives from the same params.
 */
function renderWorkforce(
  properties: BuildingPropertyValue[],
  overrides: {
    canEdit?: boolean;
    onPropertyChange?: (name: string, value: number) => void;
    onRefreshBuildingProperties?: (...args: unknown[]) => unknown;
    onReadWorkerCounts?: (...args: unknown[]) => unknown;
  } = {},
) {
  const emitted: Array<{ name: string; value: number }> = [];
  const onPropertyChange = overrides.onPropertyChange ?? ((name: string, value: number) => {
    emitted.push({ name, value });
    const resolved = resolveRdoCommand(name, RDO_COMMANDS);
    const params = buildSalaryParams(properties, resolved.params, value);
    useBuildingStore.getState().setPending(pendingKeyFor(resolved.command, params), String(value));
  });

  const callbacks = createSpiedCallbacks({
    onRefreshBuildingProperties: overrides.onRefreshBuildingProperties ?? (() => { /* no-op */ }),
    // The poll awaits this one, so the default has to be a Promise.
    onReadWorkerCounts: overrides.onReadWorkerCounts ?? (() => Promise.resolve(null)),
  });

  const view = renderWithProviders(
    <WorkforceTable
      properties={properties}
      canEdit={overrides.canEdit ?? true}
      rdoCommands={RDO_COMMANDS}
      buildingX={10}
      buildingY={20}
      onPropertyChange={onPropertyChange}
    />,
    { clientCallbacks: callbacks },
  );

  return { ...view, emitted };
}

describe('WorkforceTable — cards', () => {
  beforeEach(() => {
    resetStores();
    useBuildingStore.setState({ pendingUpdates: new Map(), confirmedUpdates: new Map(), failedUpdates: new Map(), details: null });
  });

  it('renders one card per staffed class and skips the idle one', () => {
    renderWorkforce(props());
    expect(screen.queryByText('Executives')).toBeNull();
    expect(screen.getByText('Professionals')).toBeTruthy();
    expect(screen.getByText('Workers')).toBeTruthy();
  });

  it('shows jobs, quality and hourly cost per class', () => {
    const { container } = renderWorkforce(props());
    const text = container.textContent ?? '';
    expect(text).toContain('14/14');
    expect(text).toContain('69/70');
    expect(text).toContain('50%');
    expect(text).toContain('$8.00');
    expect(text).toContain('$2.00');
  });

  it('bounds the slider by the town minimum wage and the 250% ceiling', () => {
    renderWorkforce(props());
    const professionals = screen.getByLabelText('Professionals salary') as HTMLInputElement;
    expect(professionals.min).toBe('90');
    expect(professionals.max).toBe('250');
    expect((screen.getByLabelText('Workers salary') as HTMLInputElement).min).toBe('0');
  });

  it('surfaces the town minimum so the floor is not a mystery', () => {
    const { container } = renderWorkforce(props());
    expect(container.textContent).toContain('Town minimum: 90%');
  });

  it('renders a read-only salary when the player cannot edit', () => {
    const { container } = renderWorkforce(props(), { canEdit: false });
    expect(screen.queryByLabelText('Workers salary')).toBeNull();
    expect(container.textContent).toContain('100%');
  });

  it('renders nothing but a notice when no class is staffed', () => {
    const idle = props({ WorkersCap1: '0', WorkersMax1: '0', WorkersCap2: '0', WorkersMax2: '0' });
    const { container } = renderWorkforce(idle);
    expect(container.textContent).toContain('No workforce');
  });
});

describe('WorkforceTable — commit on release', () => {
  beforeEach(() => {
    resetStores();
    useBuildingStore.setState({ pendingUpdates: new Map(), confirmedUpdates: new Map(), failedUpdates: new Map(), details: null });
  });

  it('does not emit while the thumb moves', () => {
    const { emitted } = renderWorkforce(props());
    const slider = screen.getByLabelText('Workers salary');
    fireEvent.change(slider, { target: { value: '110' } });
    fireEvent.change(slider, { target: { value: '130' } });
    fireEvent.change(slider, { target: { value: '150' } });
    expect(emitted).toHaveLength(0);
  });

  it('emits once on release, with the released value', () => {
    const { emitted } = renderWorkforce(props());
    const slider = screen.getByLabelText('Workers salary');
    fireEvent.change(slider, { target: { value: '150' } });
    fireEvent.pointerUp(slider);
    expect(emitted).toEqual([{ name: 'Salaries2', value: 150 }]);
  });

  it('emits on keyboard release too', () => {
    const { emitted } = renderWorkforce(props());
    const slider = screen.getByLabelText('Workers salary');
    fireEvent.change(slider, { target: { value: '101' } });
    fireEvent.keyUp(slider, { key: 'ArrowUp' });
    expect(emitted).toEqual([{ name: 'Salaries2', value: 101 }]);
  });

  it('sends nothing when the thumb ends where it started', () => {
    const { emitted } = renderWorkforce(props());
    const slider = screen.getByLabelText('Workers salary');
    fireEvent.change(slider, { target: { value: '130' } });
    fireEvent.change(slider, { target: { value: '100' } });
    fireEvent.pointerUp(slider);
    expect(emitted).toHaveLength(0);
  });

  it('does not re-send the same value when the release fires twice', () => {
    const { emitted } = renderWorkforce(props());
    const slider = screen.getByLabelText('Workers salary');
    fireEvent.change(slider, { target: { value: '150' } });
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    fireEvent.pointerUp(slider);
    expect(emitted).toHaveLength(1);
  });

  it('registers the pending update under the key the card watches', () => {
    const properties = props();
    renderWorkforce(properties);
    fireEvent.change(screen.getByLabelText('Professionals salary'), { target: { value: '120' } });
    fireEvent.pointerUp(screen.getByLabelText('Professionals salary'));

    // The literal shape matters: building-action-handler builds this key as
    // `${command}:${JSON.stringify(additionalParams)}`.
    const key = 'RDOSetSalaries:{"index":"1","salary0":"100","salary1":"120","salary2":"100"}';
    expect(keyFor(properties, 1, 120)).toBe(key);
    expect(useBuildingStore.getState().pendingUpdates.has(key)).toBe(true);
  });
});

describe('WorkforceTable — lock and settle', () => {
  beforeEach(() => {
    resetStores();
    useBuildingStore.setState({ pendingUpdates: new Map(), confirmedUpdates: new Map(), failedUpdates: new Map(), details: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('locks every slider while the update is in flight', () => {
    renderWorkforce(props());
    fireEvent.change(screen.getByLabelText('Professionals salary'), { target: { value: '120' } });
    fireEvent.pointerUp(screen.getByLabelText('Professionals salary'));

    expect((screen.getByLabelText('Professionals salary') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Workers salary') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows the save indicator on the class that started the update', () => {
    const properties = props();
    const { container } = renderWorkforce(properties);
    fireEvent.change(screen.getByLabelText('Workers salary'), { target: { value: '120' } });
    fireEvent.pointerUp(screen.getByLabelText('Workers salary'));

    // One dot, on the edited class — the other card is locked, not pending.
    expect(container.querySelectorAll('.pendingDot')).toHaveLength(1);

    act(() => {
      useBuildingStore.getState().confirmPending(keyFor(properties, 2, 120), 'confirmed');
    });
    expect(container.querySelector('.checkmark')).toBeTruthy();
  });

  it('asks for fresh properties once the answer lands', () => {
    const refresh = jest.fn();
    const properties = props();
    renderWorkforce(properties, { onRefreshBuildingProperties: refresh });
    fireEvent.change(screen.getByLabelText('Workers salary'), { target: { value: '120' } });
    fireEvent.pointerUp(screen.getByLabelText('Workers salary'));
    expect(refresh).not.toHaveBeenCalled();

    act(() => {
      useBuildingStore.getState().confirmPending(keyFor(properties, 2, 120), 'confirmed');
    });
    expect(refresh).toHaveBeenCalledWith(10, 20);
  });

  it('releases the lock and shows the value the server kept, not the one released', () => {
    const properties = props();
    const { rerender } = renderWorkforce(properties);
    fireEvent.change(screen.getByLabelText('Workers salary'), { target: { value: '40' } });
    fireEvent.pointerUp(screen.getByLabelText('Workers salary'));

    act(() => {
      useBuildingStore.getState().confirmPending(keyFor(properties, 2, 40), 'confirmed');
    });

    // The refresh lands: the town minimum wage pushed the salary back up to 60,
    // which is neither the value released nor the one the panel showed before.
    act(() => {
      useBuildingStore.setState({ details: details() });
    });
    rerender(
      <WorkforceTable
        properties={props({ Salaries2: '60' })}
        canEdit
        rdoCommands={RDO_COMMANDS}
        buildingX={10}
        buildingY={20}
        onPropertyChange={() => { /* no-op */ }}
      />,
    );

    const slider = screen.getByLabelText('Workers salary') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    expect(slider.value).toBe('60');
  });

  it('releases the lock even when the refresh never comes back', () => {
    jest.useFakeTimers();
    const properties = props();
    renderWorkforce(properties);
    fireEvent.change(screen.getByLabelText('Workers salary'), { target: { value: '140' } });
    fireEvent.pointerUp(screen.getByLabelText('Workers salary'));
    act(() => {
      useBuildingStore.getState().confirmPending(keyFor(properties, 2, 140), 'confirmed');
    });
    expect((screen.getByLabelText('Workers salary') as HTMLInputElement).disabled).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect((screen.getByLabelText('Workers salary') as HTMLInputElement).disabled).toBe(false);
  });

  it('releases the lock when the server refuses the change', () => {
    jest.useFakeTimers();
    const properties = props();
    renderWorkforce(properties);
    fireEvent.change(screen.getByLabelText('Workers salary'), { target: { value: '140' } });
    fireEvent.pointerUp(screen.getByLabelText('Workers salary'));
    act(() => {
      useBuildingStore.getState().failPending(keyFor(properties, 2, 140), '100', 'Server rejected the change');
    });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect((screen.getByLabelText('Workers salary') as HTMLInputElement).disabled).toBe(false);
  });
});

/**
 * The live jobs-filled figure.
 *
 * `Workers{n}` is a cached property: it only moves when the whole panel is
 * re-read. The reference client polled the block directly on a 20 s timer
 * (`Voyager/WorkforceSheet.pas:365-377`), one call per class whose maximum is
 * above zero. These tests pin the three things that makes or breaks:
 * the interval, the class list, and the fact that the number changes without the
 * card being torn down and rebuilt.
 */
describe('WorkforceTable — live worker counts', () => {
  beforeEach(() => {
    resetStores();
    useBuildingStore.setState({ pendingUpdates: new Map(), confirmedUpdates: new Map(), failedUpdates: new Map(), details: null });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Let the resolved poll promise reach setState. */
  async function flush(): Promise<void> {
    await act(async () => { /* microtask drain */ });
  }

  it('asks for the staffed classes every 20 s and patches the figure in place', async () => {
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>()
      .mockResolvedValue([{ kind: 2, workers: 70 }]);
    const { container } = renderWorkforce(props(), { onReadWorkerCounts: read });

    const before = container.querySelector('.wfCard');
    expect(read).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(20_000); });
    // Executives have WorkersMax0 = 0, so they cost no call.
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(10, 20, [1, 2]);

    await flush();
    expect(container.textContent).toContain('70/70');
    // Same element: the number moved, the card did not remount.
    expect(container.querySelector('.wfCard')!.isSameNode(before)).toBe(true);
  });

  it('does not ask before the first interval is up', () => {
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>().mockResolvedValue(null);
    renderWorkforce(props(), { onReadWorkerCounts: read });

    act(() => { jest.advanceTimersByTime(19_999); });
    expect(read).not.toHaveBeenCalled();
  });

  it('never asks for the whole tab again — the poll reads three numbers, not the panel', () => {
    const refresh = jest.fn();
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>().mockResolvedValue(null);
    renderWorkforce(props(), { onReadWorkerCounts: read, onRefreshBuildingProperties: refresh });

    act(() => { jest.advanceTimersByTime(60_000); });
    expect(read).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops when the tab is left or the inspector closes', () => {
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>().mockResolvedValue(null);
    const { unmount } = renderWorkforce(props(), { onReadWorkerCounts: read });

    act(() => { jest.advanceTimersByTime(20_000); });
    expect(read).toHaveBeenCalledTimes(1);

    // Both leaving the tab and closing the inspector unmount the table.
    unmount();
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('pauses while the document is hidden and resumes when it is shown', () => {
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>().mockResolvedValue(null);
    renderWorkforce(props(), { onReadWorkerCounts: read });

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { jest.advanceTimersByTime(60_000); });
    expect(read).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { jest.advanceTimersByTime(20_000); });
    expect(read).toHaveBeenCalledTimes(1);

    delete (document as unknown as Record<string, unknown>).hidden;
  });

  it('lets a fresh property read win over the live figure', async () => {
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>()
      .mockResolvedValue([{ kind: 2, workers: 70 }]);
    const { container, rerender } = renderWorkforce(props(), { onReadWorkerCounts: read });

    act(() => { jest.advanceTimersByTime(20_000); });
    await flush();
    expect(container.textContent).toContain('70/70');

    rerender(
      <WorkforceTable
        properties={props({ Workers2: '65' })}
        canEdit
        rdoCommands={RDO_COMMANDS}
        buildingX={10}
        buildingY={20}
        onPropertyChange={() => { /* no-op */ }}
      />,
    );
    expect(container.textContent).toContain('65/70');
  });

  it('keeps the cached figure when the read comes back empty-handed', async () => {
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>().mockResolvedValue(null);
    const { container } = renderWorkforce(props(), { onReadWorkerCounts: read });

    act(() => { jest.advanceTimersByTime(20_000); });
    await flush();
    expect(container.textContent).toContain('69/70');
  });

  it('survives a rejected read without breaking the panel', async () => {
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>()
      .mockRejectedValue(new Error('socket gone'));
    const { container } = renderWorkforce(props(), { onReadWorkerCounts: read });

    act(() => { jest.advanceTimersByTime(20_000); });
    await flush();
    expect(container.textContent).toContain('69/70');
  });

  it('polls nothing when no class is staffed', () => {
    const read = jest.fn<(...args: unknown[]) => Promise<WorkerCount[] | null>>().mockResolvedValue(null);
    const idle = props({ WorkersCap1: '0', WorkersMax1: '0', WorkersCap2: '0', WorkersMax2: '0' });
    renderWorkforce(idle, { onReadWorkerCounts: read });

    act(() => { jest.advanceTimersByTime(60_000); });
    expect(read).not.toHaveBeenCalled();
  });
});
