// Presentation helpers shared by every screen that shows an order: the
// post-checkout confirmation, the Orders list, and the order detail. Kept in
// one place so an order reads identically wherever it appears.
import type { DeliveryStatus, OrderRecord } from '../types';

/** Cents → "$12.34". Order money is stored in cents precisely so it never goes
 *  through a float; this is the only place it turns back into a string. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function itemCount(order: OrderRecord): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** "3 items" / "1 item". */
export function itemCountLabel(order: OrderRecord): string {
  const count = itemCount(order);
  return `${count} item${count === 1 ? '' : 's'}`;
}

/** "Today at 6:42 PM" / "Yesterday at 1:05 PM" / "Mar 3 at 7:15 PM". Relative
 *  for the two days a customer is most likely to be looking at. */
export function placedAtLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (date.toDateString() === today.toDateString()) return `Today at ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
  return `${day} at ${time}`;
}

/** The full delivery address as one line, apartment included. */
export function addressLabel(order: OrderRecord): string {
  return [order.deliveryAddressLine, order.deliveryApartmentSuite]
    .filter((part) => part && part.trim().length > 0)
    .join(', ');
}

/** A demo-mode order took no real money. Worth saying so on a receipt rather
 *  than showing a total that looks like a charge. */
export function isDemoOrder(order: OrderRecord): boolean {
  return order.paymentIntentID.startsWith('pi_demo_');
}

export interface StatusPresentation {
  label: string;
  /** Which theme colour token the badge uses. */
  tone: 'orange' | 'navy' | 'green' | 'muted';
  icon: 'time-outline' | 'restaurant-outline' | 'bicycle-outline' | 'navigate-outline' | 'checkmark-circle';
}

/**
 * What to show for an order's state, preferring live delivery progress over the
 * local record's own coarse status.
 *
 * `deliveryStatus` is null until a driver claims the order (or always, with no
 * backend configured), which is why the fallback says "Placed" rather than
 * anything about a driver.
 */
export function statusPresentation(order: OrderRecord): StatusPresentation {
  const live: DeliveryStatus | null = order.deliveryStatus;
  switch (live) {
    case 'accepted':
      return { label: 'Driver heading to restaurant', tone: 'orange', icon: 'restaurant-outline' };
    case 'picked_up':
      return { label: 'On the way to you', tone: 'orange', icon: 'bicycle-outline' };
    case 'nearby':
      return { label: 'Almost there', tone: 'orange', icon: 'navigate-outline' };
    case 'arrived':
      return { label: 'Driver is at your door', tone: 'green', icon: 'navigate-outline' };
    case 'delivered':
      return { label: 'Delivered', tone: 'green', icon: 'checkmark-circle' };
    default:
      if (order.status === 'Cancelled') {
        return { label: 'Cancelled', tone: 'muted', icon: 'time-outline' };
      }
      return { label: 'Order placed', tone: 'navy', icon: 'time-outline' };
  }
}

/** True while the order is still moving — it belongs under "Active" rather
 *  than in the past-orders list. */
export function isInFlight(order: OrderRecord): boolean {
  if (order.status === 'Cancelled') return false;
  if (order.deliveryStatus === 'delivered') return false;
  // With no backend there's no delivery status to advance, so an order would
  // otherwise sit under "Active" forever. Treat a day as long enough.
  if (order.deliveryStatus === null) {
    return Date.now() - new Date(order.placedAt).getTime() < 24 * 60 * 60 * 1000;
  }
  return true;
}
