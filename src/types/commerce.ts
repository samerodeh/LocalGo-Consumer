export type FulfillmentMode = 'delivery' | 'pickup';
export type MerchantCategory = 'restaurants' | 'grocery' | 'convenience' | 'specialty' | 'pharmacy';
export interface MerchantMetadata {
  id: string;
  category: MerchantCategory;
  pickupEnabled: boolean;
  verified: boolean;
  topLocal: boolean;
  rating: number | null;
  reviewCount: number;
  latitude: number | null;
  longitude: number | null;
  deliveryFeeCents: number;
  etaMin: number;
  etaMax: number;
}
export interface CheckoutQuote {
  subtotalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  discountCents: number;
  totalCents: number;
  promoCode: string | null;
  currency: 'CAD';
}
export interface OrderLocation {
  latitude: number;
  longitude: number;
  updatedAt: string;
}
export interface ConsumerOrder {
  id: string;
  orderNumber: string;
  merchantId: string;
  merchantName: string;
  mode: FulfillmentMode;
  status: string;
  createdAt: string;
  totalCents: number;
  courierLocation: OrderLocation | null;
  dropoff: { latitude: number; longitude: number } | null;
  merchant: { latitude: number | null; longitude: number | null };
  reviewed: boolean;
}
