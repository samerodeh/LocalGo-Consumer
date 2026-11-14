import { useEffect, useState } from 'react';
import { quoteCart, quotePayload } from '../lib/consumerApi';
import type { CartLine } from '../types';
import type { CheckoutQuote, FulfillmentMode } from '../types/commerce';
/** A quote is usable only for the exact current basket, fulfillment and tip. */
export function useCartQuote(
  lines: CartLine[],
  merchantId: string | null,
  mode: FulfillmentMode,
  tipCents: number,
  promo: string | null,
  enabled: boolean,
) {
  const signature = JSON.stringify(quotePayload(lines, merchantId ?? '', mode, tipCents, promo));
  const [result, setResult] = useState<{
    signature: string;
    quote: CheckoutQuote | null;
    error: string | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !merchantId || !lines.length) return;
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void quoteCart(lines, merchantId, mode, tipCents, promo, controller.signal)
        .then((quote) => {
          if (alive) setResult({ signature, quote, error: null });
        })
        .catch((e) => {
          if (alive)
            setResult({
              signature,
              quote: null,
              error: e instanceof Error ? e.message : 'Could not update your total.',
            });
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [signature, enabled, retry]);
  const current = result?.signature === signature ? result : null;
  return {
    quote: current?.quote ?? null,
    error: current?.error ?? null,
    loading: enabled && Boolean(lines.length) && !current,
    refresh: () => {
      setResult(null);
      setRetry((v) => v + 1);
    },
    signature,
  };
}
