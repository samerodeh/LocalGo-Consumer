import { API_URL } from './api';
import { authHeaders } from './authHeaders';
import type { Address, CartLine, Restaurant } from '../types';
import type {
  CheckoutQuote,
  ConsumerOrder,
  FulfillmentMode,
  MerchantMetadata,
} from '../types/commerce';
export async function consumerRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!API_URL) throw new Error('The store service is currently unavailable.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('The store service took too long. Please retry.'));
    }, 15000);
  });
  const perform = async () => {
    const auth = await authHeaders();
    if (controller.signal.aborted) throw new Error('The request was cancelled.');
    const response = await fetch(`${API_URL}/consumer${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: auth,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        typeof json?.detail === 'string'
          ? json.detail
          : 'The store service is temporarily unavailable. Please try again.',
      );
    return json as T;
  };
  try {
    return await Promise.race([perform(), timeout]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export interface CatalogMerchant extends Restaurant, MerchantMetadata {}
export async function getCatalog(signal?: AbortSignal): Promise<CatalogMerchant[]> {
  const { merchants } = await consumerRequest<{ merchants: Record<string, unknown>[] }>(
    '/catalog',
    undefined,
    signal,
  );
  return merchants.map((m) => ({
    id: String(m.id),
    name: String(m.name),
    cuisine: String(m.cuisine),
    address: String(m.address),
    logoURL: m.logo_url as string | null,
    heroImageURL: m.hero_image_url as string | null,
    heroIcon: 'restaurant-outline',
    distance: '',
    deliveryTime: `${m.eta_min}–${m.eta_max} min`,
    deliveryFee: `$${(Number(m.delivery_fee_cents) / 100).toFixed(2)} delivery`,
    hasMenu: m.has_menu !== false,
    category: m.category as MerchantMetadata['category'],
    pickupEnabled: m.pickup_enabled === true,
    verified: m.verified === true,
    topLocal: m.top_local === true,
    rating: m.rating === null ? null : Number(m.rating),
    reviewCount: Number(m.review_count ?? 0),
    latitude: m.latitude as number | null,
    longitude: m.longitude as number | null,
    deliveryFeeCents: Number(m.delivery_fee_cents),
    etaMin: Number(m.eta_min),
    etaMax: Number(m.eta_max),
  }));
}
export function quotePayload(
  lines: CartLine[],
  merchantId: string,
  mode: FulfillmentMode,
  tipCents: number,
  promoCode: string | null,
) {
  return {
    merchantId,
    mode,
    tipCents: mode === 'pickup' ? 0 : tipCents,
    promoCode,
    items: lines.map((l) => ({
      productId: l.item.id,
      quantity: l.quantity,
      selections: (l.selections ?? []).map((s) => ({
        groupId: s.groupId,
        choiceNames: s.choiceNames,
      })),
      notes: l.notes ?? '',
    })),
  };
}
export function quoteCart(
  lines: CartLine[],
  merchantId: string,
  mode: FulfillmentMode,
  tipCents: number,
  promoCode: string | null,
  signal?: AbortSignal,
) {
  return consumerRequest<CheckoutQuote>(
    '/quote',
    quotePayload(lines, merchantId, mode, tipCents, promoCode),
    signal,
  );
}
export async function checkoutCart({
  id,
  lines,
  merchantId,
  mode,
  quote,
  address,
  customerName,
}: {
  id: string;
  lines: CartLine[];
  merchantId: string;
  mode: FulfillmentMode;
  quote: CheckoutQuote;
  address: Address | null;
  customerName: string;
}) {
  return consumerRequest<{ id: string; orderNumber: string; quote: CheckoutQuote }>('/checkout', {
    ...quotePayload(lines, merchantId, mode, quote.tipCents, quote.promoCode),
    id,
    expectedTotalCents: quote.totalCents,
    customerName,
    address:
      mode === 'delivery' && address
        ? {
            addressLine: address.addressLine,
            latitude: address.latitude,
            longitude: address.longitude,
            apartmentSuite: address.apartmentSuite,
            instructions: address.instructions,
            entryCode: address.entryCode,
            preference: address.deliveryPreference,
          }
        : null,
  });
}
export function getConsumerOrders(signal?: AbortSignal) {
  return consumerRequest<{ orders: ConsumerOrder[] }>('/orders', undefined, signal);
}
export async function getMerchantMenu(merchantId: string, signal?: AbortSignal) {
  const { items } = await consumerRequest<{ items: Record<string, unknown>[] }>(
    `/merchants/${encodeURIComponent(merchantId)}/menu`,
    undefined,
    signal,
  );
  return items.map((p) => ({
    id: String(p.product_id),
    name: String(p.name),
    category: String(p.category),
    price: Number(p.price_cents) / 100,
    icon: 'restaurant-outline' as const,
    itemDescription: p.description as string | null,
    imageURL: p.image_url as string | null,
    allowsNotes: p.allows_notes === true,
    optionGroups: p.option_groups as import('../types').MenuOptionGroup[],
  }));
}
