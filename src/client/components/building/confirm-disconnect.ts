import { useUiStore } from '../../store/ui-store';

/**
 * Disconnecting is destructive and used to fire at once (Fire button, Delete key). It now goes
 * through the shared Dialog (T3, B5): focus lands on Cancel, Escape cancels. One dialog covers
 * the whole selection — it names the count when more than one row is going.
 */
export function confirmDisconnect(names: string[], fluidLabel: string, direction: 'input' | 'output', onConfirm: () => void): void {
  const n = names.length;
  const title = n === 1
    ? `Disconnect ${names[0]}?`
    : `Disconnect ${n} ${direction === 'input' ? 'suppliers' : 'buyers'}?`;
  const message = direction === 'input'
    ? (n === 1
      ? `This building will stop receiving ${fluidLabel} from ${names[0]}. You can reconnect it later.`
      : `This building will stop receiving ${fluidLabel} from ${n} suppliers: ${names.join(', ')}. You can reconnect them later.`)
    : (n === 1
      ? `${names[0]} will stop buying ${fluidLabel} here. You can reconnect it later.`
      : `${n} buyers will stop buying ${fluidLabel} here: ${names.join(', ')}. You can reconnect them later.`);
  useUiStore.getState().requestConfirm(
    title,
    message,
    onConfirm,
    { kind: 'destructive', confirmLabel: 'Disconnect', typeToConfirm: null },
  );
}
