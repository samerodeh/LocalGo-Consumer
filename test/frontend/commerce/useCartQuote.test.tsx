import { act, renderHook } from '@testing-library/react-native';
import { useCartQuote } from '../../../src/store/useCartQuote';
import { quoteCart } from '../../../src/lib/consumerApi';
import type { CartLine } from '../../../src/types';
jest.mock('../../../src/lib/consumerApi', () => ({
  quoteCart: jest.fn(),
  quotePayload: (
    lines: CartLine[],
    id: string,
    mode: string,
    tip: number,
    promo: string | null,
  ) => ({ lines, id, mode, tip, promo }),
}));
const lines: CartLine[] = [
  {
    lineId: 'one',
    quantity: 1,
    item: {
      id: 'bowl',
      name: 'Bowl',
      category: 'Bowls',
      price: 12.5,
      icon: 'restaurant',
      itemDescription: null,
      imageURL: null,
    },
  },
];
const quote = {
  subtotalCents: 1250,
  deliveryFeeCents: 500,
  tipCents: 200,
  discountCents: 0,
  totalCents: 1950,
  promoCode: null,
  currency: 'CAD' as const,
};
const mock = jest.mocked(quoteCart);
describe('authoritative cart quote lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mock.mockReset();
  });
  afterEach(() => jest.useRealTimers());
  it('immediately invalidates the prior total when tip or fulfillment changes', async () => {
    mock.mockResolvedValue(quote);
    const h = renderHook(
      ({ tip, mode }: { tip: number; mode: 'delivery' | 'pickup' }) =>
        useCartQuote(lines, 'al-taib', mode, tip, null, true),
      { initialProps: { tip: 200, mode: 'delivery' } },
    );
    await act(async () => {
      jest.advanceTimersByTime(150);
    });
    expect(h.result.current.quote?.totalCents).toBe(1950);
    h.rerender({ tip: 0, mode: 'pickup' });
    expect(h.result.current.quote).toBeNull();
    expect(h.result.current.loading).toBe(true);
  });
  it('ignores a late response for an obsolete basket and aborts it', async () => {
    let resolve: (value: typeof quote) => void = () => {};
    mock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const h = renderHook(
      ({ tip }: { tip: number }) => useCartQuote(lines, 'al-taib', 'delivery', tip, null, true),
      { initialProps: { tip: 200 } },
    );
    await act(async () => {
      jest.advanceTimersByTime(150);
    });
    const signal = mock.mock.calls[0][5];
    h.rerender({ tip: 300 });
    expect(signal?.aborted).toBe(true);
    await act(async () => resolve(quote));
    expect(h.result.current.quote).toBeNull();
  });
  it('does not produce a quote on an upstream failure', async () => {
    mock.mockRejectedValue(new Error('Promotion expired'));
    const h = renderHook(() => useCartQuote(lines, 'al-taib', 'delivery', 200, 'CODE', true));
    await act(async () => {
      jest.advanceTimersByTime(150);
    });
    expect(h.result.current.quote).toBeNull();
    expect(h.result.current.error).toBe('Promotion expired');
  });
});
