import { useCartStore } from '../../store/cartStore';
import { menuItemById, resolveMenuItem } from '../menuIndex';
import { goerMsg } from '../goerStore';
import type { ToolExecution } from '../types';

export async function executeServerCartAction(name: string, input: Record<string, unknown>): Promise<ToolExecution> {
  const store = useCartStore.getState();
  await store.refresh();
  if (store.pending) throw new Error('Reconcile the pending cart request before another cart action.');
  if (name === 'clear_cart') await store.mutate('clear');
  else if (name !== 'view_cart') {
    const entries = name === 'add_to_cart' && Array.isArray(input.items) ? input.items : [input];
    if (entries.length !== 1) return { resultText: 'Please request one cart change at a time.', isError: true };
    const entry = entries[0] as Record<string, unknown>;
    const resolved = typeof entry.item_id === 'string' ? menuItemById(entry.item_id)
      : typeof entry.query === 'string' ? resolveMenuItem(entry.query) : null;
    const item = resolved && 'kind' in resolved ? resolved.kind === 'match' ? resolved.item : null : resolved;
    if (!item) return { resultText: 'Which exact product do you mean?', isError: true };
    const quantity = entry.quantity ?? 1;
    if (!Number.isInteger(quantity) || Number(quantity) < 0 || Number(quantity) > 99) {
      return { resultText: 'Use a whole-number quantity from 1 to 99, or zero to remove a line.', isError: true };
    }
    if (name === 'remove_from_cart' || (name === 'set_quantity' && quantity === 0)) {
      await store.mutate('remove', item.id);
    } else await store.mutate(name === 'add_to_cart' ? 'add' : 'set', item.id, Number(quantity));
  }
  const current = useCartStore.getState();
  return { resultText: `Cart updated from LocalGo. Total before tip: $${current.total().toFixed(2)}.`,
    widgets: [goerMsg({ kind: 'cart_summary', snapshot: {
      lines: current.lines.map(line => ({ itemID: line.item.id, name: line.item.name,
        quantity: line.quantity, unitPrice: line.item.price })),
      subtotal: current.subtotal(), deliveryFee: current.deliveryFee(), total: current.total(),
    } })] };
}
