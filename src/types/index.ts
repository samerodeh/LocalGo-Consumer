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
  distance: string;
  deliveryTime: string;
  deliveryFee: string;
  /** Only Al Taib has a real menu today; placeholders show "coming soon". */
  hasMenu: boolean;
}

export interface MenuOptionChoice {
  id: string;
  name: string;
  /** Additional cost if selected; 0 for included/no-charge choices. */
  priceDelta: number;
}

export interface MenuOptionGroup {
  id: string;
  title: string;
  selectionType: 'single' | 'multiple';
  required: boolean;
  /** For 'single' groups this is always 1. */
  maxSelect: number;
  choices: MenuOptionChoice[];
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
  /** Real per-item customizations (size, add-ons, quantity tiers, upsells...), mirroring the restaurant's own ordering site. */
  optionGroups?: MenuOptionGroup[];
  /** Whether this item accepts a free-text preferences note. */
  allowsNotes?: boolean;
}

/** A group's resolved choice(s) for one cart line, snapshotted at add-to-cart time. */
export interface CartLineSelection {
  groupId: string;
  groupTitle: string;
  choiceNames: string[];
  priceDelta: number;
}

export interface CartLine {
  /** Unique per customization, so two differently-configured orders of the same item are separate lines. */
  lineId: string;
  item: MenuItem;
  quantity: number;
  selections?: CartLineSelection[];
  notes?: string;
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

export type OrderStatus = 'Placed' | 'Preparing' | 'Out for Delivery' | 'Delivered' | 'Cancelled';

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
  id: string;
  ownerEmail: string;
  restaurantID: string;
  restaurantName: string;
  placedAt: string;
  status: OrderStatus;
  currency: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
  discountCents?: number;
  fulfillmentMode?: 'delivery' | 'pickup';
  serverOrderId?: string;
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
  /** Set when the message carries a photo (driver's pickup/drop-off proof, or either participant attaching one in chat). */
  imageUrl: string | null;
  /** Set when the message is a voice note. */
  audioUrl: string | null;
  /** Playback length of the voice note in seconds, shown next to the play button. */
  audioDurationSec: number | null;
  createdAt: string;
  readAt: string | null;
}
