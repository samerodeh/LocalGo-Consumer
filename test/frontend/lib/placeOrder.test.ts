import { placeOrder, type PlaceOrderInput } from '../../../src/lib/placeOrder';
import { publishOrderToDispatch } from '../../../src/lib/dispatch';
import { useCartStore } from '../../../src/store/cartStore';
import { useOrdersStore } from '../../../src/store/ordersStore';
jest.mock('../../../src/lib/dispatch', () => ({ publishOrderToDispatch: jest.fn() }));
jest.mock('../../../src/lib/supabase', () => ({ supabase: null }));
jest.mock('../../../src/lib/deliveryLocation', () => ({ deliveryLocationProblem: () => null }));
jest.mock('../../../src/store/cartStore', () => ({ useCartStore: { getState: jest.fn() } }));
jest.mock('../../../src/store/ordersStore', () => ({ useOrdersStore: { getState: jest.fn() } }));
const record = jest.fn();
const clear = jest.fn();
const input = { lines: [{}], subtotal: 20, deliveryFee: 5, tip: 2, total: 27, restaurantID: 'al-taib', deliveryAddress: null, customer: null } as PlaceOrderInput;
beforeEach(() => {
  jest.useFakeTimers();
  (useCartStore.getState as jest.Mock).mockReturnValue({ clear });
  (useOrdersStore.getState as jest.Mock).mockReturnValue({ record });
  record.mockResolvedValue(undefined);
});
afterEach(() => jest.useRealTimers());
it('keeps the cart and avoids a local success record when dispatch fails', async () => {
  (publishOrderToDispatch as jest.Mock).mockResolvedValue(null);
  const pending = placeOrder(input);
  await jest.advanceTimersByTimeAsync(1200);
  expect(await pending).toMatchObject({ ok: false });
  expect(clear).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
});
it('records and clears the cart only after dispatch acknowledgement', async () => {
  let acknowledge!: (id: string) => void;
  (publishOrderToDispatch as jest.Mock).mockReturnValue(new Promise((resolve) => { acknowledge = resolve; }));
  const pending = placeOrder(input);
  await jest.advanceTimersByTimeAsync(1200);
  expect(clear).not.toHaveBeenCalled();
  expect(record).not.toHaveBeenCalled();
  acknowledge('dispatch-id');
  expect(await pending).toEqual({ ok: true });
  expect(record).toHaveBeenCalledTimes(1);
  expect(clear).toHaveBeenCalledTimes(1);
});
