import type { Ionicons } from '@expo/vector-icons';

export type IoniconName = keyof typeof Ionicons.glyphMap;

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  /** Street address of the restaurant; used as the driver's pickup location. */
  address: string;
  logoURL: string | null;
  heroImageURL: string | null;
  /** Ionicon shown when there's no hero/logo image (placeholder partners). */
  heroIcon: IoniconName;
  rating: string;
  reviewCount: string;
  distance: string;
  deliveryTime: string;
  deliveryFee: string;
  /** Only Al Taib has a real menu today; placeholders show "coming soon". */
  hasMenu: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  icon: IoniconName;
  itemDescription: string | null;
  /** Remote product photo; null falls back to `icon`. */
  imageURL: string | null;
}

export interface CartLine {
  item: MenuItem;
  quantity: number;
}

export interface StoredUser {
  firstName: string;
  lastName: string;
  email: string;
  /** Salted hash + salt for password accounts (hex-encoded). */
  passwordHash: string | null;
  passwordSalt: string | null;
  createdAt: string;
  failedLoginAttempts: number;
  /** ISO timestamp; account is locked until this instant after too many failures. */
  lockoutUntil: string | null;
}

export type AddressType = 'House' | 'Apartment' | 'Office' | 'Other';
export type DeliveryPreference = 'Leave at door' | 'Meet at door';
export type PersonalLabel = 'None' | 'Home' | 'Work' | 'Custom';

export interface Address {
  id: string;
  ownerEmail: string;
  isDefault: boolean;
  latitude: number;
  longitude: number;
  sortOrder: number;
  addressLine: string;
  postalCode: string;
  addressType: AddressType;
  apartmentSuite: string;
  entryCode: string;
  buildingName: string;
  deliveryPreference: DeliveryPreference;
  instructions: string;
  personalLabel: PersonalLabel;
  customLabelName: string;
  updatedAt: string;
}

/** A saved card. Only the last 4 digits are ever persisted — never the full PAN
 *  or CVV — so there's no sensitive card data at rest. Stand-in for a real
 *  tokenized payment method (Stripe et al.). */
export interface PaymentCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: string;
  expYear: string;
  cardholder: string;
  isDefault: boolean;
}

export type OrderStatus =
  | 'Placed'
  | 'Preparing'
  | 'Out for Delivery'
  | 'Delivered'
  | 'Cancelled';

/** How far a delivery has progressed, as the driver reports it. Mirrors the
 *  shared `orders.delivery_status` column; 'available' means no driver has
 *  claimed it yet. Kept separate from `OrderStatus` (the local record's own
 *  coarse state) because this one is owned by the server. */
export type DeliveryStatus =
  | 'available'
  | 'accepted'
  | 'picked_up'
  | 'nearby'
  | 'arrived'
  | 'delivered';

export interface OrderItemRecord {
  id: string;
  menuItemID: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

/** One placed order. Money in cents so totals can't drift from float rounding. */
export interface OrderRecord {
  /** The SAME id the order was dispatched under — the shared `orders` row's
   *  primary key, the Stripe metadata's `order_id`, and the chat thread id.
   *  One id end to end is what lets local history be matched up with live
   *  delivery progress and with a tapped push notification. */
  id: string;
  ownerEmail: string;
  restaurantID: string;
  restaurantName: string;
  placedAt: string;
  status: OrderStatus;
  /** Human-facing order number from the backend ("#LG-1234"), shown to the
   *  customer and quoted in every push. Null for orders placed with no backend
   *  configured, where nothing ever assigns one. */
  orderNumber: string | null;
  /** Latest delivery progress mirrored from the server, refreshed by
   *  `ordersStore.syncDeliveryStatus()`. Null until a driver claims it. */
  deliveryStatus: DeliveryStatus | null;
  /** The photo the driver took of this order at pickup, if they've got there. */
  pickupPhotoURL: string | null;
  currency: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
  paymentIntentID: string;
  items: OrderItemRecord[];
  // Delivery address snapshot, copied at checkout time.
  deliveryAddressLine: string;
  deliveryApartmentSuite: string;
  deliveryInstructions: string;
  deliveryPreference: string;
}

/** One chat message between a customer and the driver who accepted their
 *  order. `orderId` is the shared `orders.id` — the order row IS the thread,
 *  there's no separate conversation object. `senderId` is a Supabase Auth
 *  uid (customer or driver); the UI decides "mine" vs "theirs" by comparing
 *  it to the signed-in user's own uid. */
export interface Message {
  id: string;
  orderId: string;
  senderId: string;
  body: string;
  /** Set when the message carries a photo (driver's pickup/drop-off proof). */
  imageUrl: string | null;
  createdAt: string;
  readAt: string | null;
}
