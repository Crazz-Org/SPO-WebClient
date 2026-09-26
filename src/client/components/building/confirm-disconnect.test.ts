import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { confirmDisconnect } from './confirm-disconnect';
import { useUiStore } from '../../store/ui-store';

type RequestConfirm = ReturnType<typeof useUiStore.getState>['requestConfirm'];

describe('confirmDisconnect', () => {
  let original: RequestConfirm;
  let spy: jest.Mock<RequestConfirm>;

  beforeEach(() => {
    original = useUiStore.getState().requestConfirm;
    spy = jest.fn<RequestConfirm>();
    useUiStore.setState({ requestConfirm: spy });
  });

  afterEach(() => {
    useUiStore.setState({ requestConfirm: original });
  });

  const options = { kind: 'destructive', confirmLabel: 'Disconnect', typeToConfirm: null } as const;

  it('one supplier: names it, and hands over the callback untouched', () => {
    const onConfirm = () => undefined;
    confirmDisconnect(['A'], 'Cotton', 'input', onConfirm);
    expect(spy).toHaveBeenCalledWith(
      'Disconnect A?',
      'This building will stop receiving Cotton from A. You can reconnect it later.',
      onConfirm,
      options,
    );
  });

  it('several suppliers: counts and lists them', () => {
    confirmDisconnect(['A', 'B'], 'Cotton', 'input', () => undefined);
    const [title, message] = spy.mock.calls[0];
    expect(title).toBe('Disconnect 2 suppliers?');
    expect(message).toBe('This building will stop receiving Cotton from 2 suppliers: A, B. You can reconnect them later.');
    expect(spy.mock.calls[0][3]).toEqual(options);
  });

  it('one buyer: names it', () => {
    confirmDisconnect(['Shop'], 'Fabric', 'output', () => undefined);
    const [title, message] = spy.mock.calls[0];
    expect(title).toBe('Disconnect Shop?');
    expect(message).toBe('Shop will stop buying Fabric here. You can reconnect it later.');
  });

  it('several buyers: counts and lists them', () => {
    confirmDisconnect(['S1', 'S2'], 'Fabric', 'output', () => undefined);
    const [title, message] = spy.mock.calls[0];
    expect(title).toBe('Disconnect 2 buyers?');
    expect(message).toBe('2 buyers will stop buying Fabric here: S1, S2. You can reconnect them later.');
  });
});
