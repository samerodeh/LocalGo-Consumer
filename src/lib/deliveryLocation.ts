// Delivery-location validation, shared by every checkout entry point (Cart
// screen, Goer's stage/confirm flow, and placeOrder itself). An address counts
// as a valid delivery location only when it has a real street line AND
// verified coordinates (picked from an autocomplete suggestion, resolved by
// geocoding, or captured from the device GPS) — a bare typed string that never
// matched a real place can't be delivered to.
import type { Address } from '../types';
import { DELIVERY_ZONE, isInDeliveryZone } from './deliveryZone';

/** True when the address carries usable geocoded coordinates. (0, 0) is the
 *  "never geocoded" sentinel written by older saves, not a real dropoff. */
export function hasVerifiedCoordinates(address: Pick<Address, 'latitude' | 'longitude'>): boolean {
  const { latitude, longitude } = address;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude === 0 && longitude === 0) return false;
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

export function isValidDeliveryLocation(address: Address | null): address is Address {
  return deliveryLocationProblem(address) === null;
}

/** Null when the address is a valid delivery location, otherwise a
 *  user-facing explanation of what's missing. */
export function deliveryLocationProblem(address: Pick<Address, 'addressLine' | 'latitude' | 'longitude'> | null): string | null {
  if (!address) {
    return 'Please add a delivery address before placing an order.';
  }
  if (address.addressLine.trim().length < 4) {
    return 'Your delivery address is incomplete — please update it before ordering.';
  }
  if (!hasVerifiedCoordinates(address)) {
    return 'We couldn’t verify your delivery address location. Please re-save it by picking a suggestion or using your current location.';
  }
  if (!isInDeliveryZone(address.latitude, address.longitude)) {
    return `We only deliver within ${DELIVERY_ZONE.radiusKm} km of ${DELIVERY_ZONE.label}. Please choose a delivery address inside that area.`;
  }
  return null;
}
