import { goerOwnerGeneration, useGoerStore } from './goerStore';
import { useAddressStore } from '../store/addressStore';
import { useAuthStore } from '../store/authStore';
import { useCartStore } from '../store/cartStore';
import { searchAddresses, type GeoResult } from '../lib/geocoding';
import { deliveryLocationProblem } from '../lib/deliveryLocation';
import { cancelPendingCheckout } from '../lib/checkoutSession';

const checkout = /^(?:please )?(?:check ?out|place (?:my |the )?order|order now|ready to order|pay)(?: please)?[.!]?$/i;
const addressList = /^(?:my |delivery )?addresses[.!]?$/i;
const money = (value: number) => `$${value.toFixed(2)} CAD`;
let choices: { generation: number; values: Array<{ id?: string; location: GeoResult }> } | null = null;

export function isCheckoutChatCommand(text: string): boolean {
  return checkout.test(text) || addressList.test(text) || /^(?:confirm order|cancel checkout|deliver to|use address|tip)\b/i.test(text);
}

/** Deterministic checkout controls: model prose is never authorization to pay. */
export async function runCheckoutChatCommand(text: string): Promise<string> {
  const generation = goerOwnerGeneration();
  const email = useGoerStore.getState().ownerEmail;
  const current = () => generation === goerOwnerGeneration() && email === useGoerStore.getState().ownerEmail;
  const assertOwner = () => {
    if (!current() || !email || useAuthStore.getState().currentUser?.email !== email
        || useAddressStore.getState().ownerEmail !== email) {
      throw new Error('Wait for your signed-in account and addresses to load, then retry.');
    }
  };
  assertOwner();
  if (checkout.test(text)) {
    await useCartStore.getState().refresh();
    assertOwner();
    const outcome = useGoerStore.getState().stageOrder();
    if (!outcome.ok) return outcome.error;
    const staged = outcome.staged;
    if (!staged.address) return 'Choose a delivery address here before confirming checkout.';
    const lines = staged.lines.map(line => `${line.quantity} × ${line.item.name}`).join('\n');
    return `${lines}\nDelivery: ${staged.address.addressLine}\nSubtotal: ${money(staged.subtotal)}\nDelivery fee: ${money(staged.deliveryFee)}\nTip: ${money(staged.tip)}\nTotal: ${money(staged.total)}\n\nNo payment has been made. To authorize this checkout, type CONFIRM ORDER ${staged.id.slice(0, 8)}. Stripe may ask for secure payment details or bank verification without leaving the checkout flow. Type "tip $0", "addresses", or "cancel checkout" to change your choice.`;
  }
  if (/^confirm order\b/i.test(text)) {
    const staged = useGoerStore.getState().stagedOrder;
    if (!staged || staged.status !== 'staged') return 'No current summary is ready. Type "checkout" to review your cart, delivery address and total first.';
    if (text.toLowerCase() !== `confirm order ${staged.id.slice(0, 8)}`.toLowerCase()) {
      return `To explicitly authorize the displayed ${money(staged.total)} total, type CONFIRM ORDER ${staged.id.slice(0, 8)}. Nothing has been charged by this message.`;
    }
    return useGoerStore.getState().confirmStagedOrder(false);
  }
  if (/^cancel checkout\b/i.test(text)) {
    if (text.toLowerCase() !== 'cancel checkout') return 'Type "cancel checkout" exactly to request cancellation of an unfinished checkout.';
    await cancelPendingCheckout(email!);
    assertOwner();
    useGoerStore.setState({ stagedOrder: null });
    await useCartStore.getState().refresh();
    assertOwner();
    return 'The unfinished checkout is canceled. Your cart is still available. Paid or processing payments cannot be canceled by this command.';
  }
  if (/^tip\b/i.test(text)) {
    const match = /^tip\s+(?:\$(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)%)$/i.exec(text);
    if (!match) return 'Type "tip $2.00" or "tip 15%". Tip changes require a new checkout summary.';
    const value = Number(match[1] ?? match[2]);
    if (!Number.isFinite(value) || value > (match[1] ? 50 : 100)) return 'Use a tip from $0 to $50, or 0% to 100%.';
    useGoerStore.getState().setChatTip({ kind: match[1] ? 'amount' : 'percent', value });
    return 'Tip updated. Type "checkout" to review the new total before confirming payment.';
  }
  if (addressList.test(text)) {
    const addresses = useAddressStore.getState().allAddresses.filter(address => !deliveryLocationProblem(address));
    choices = { generation, values: addresses.map(address => ({ id: address.id, location: {
      label: address.addressLine, addressLine: address.addressLine, postalCode: address.postalCode,
      city: '', latitude: address.latitude, longitude: address.longitude,
    } })) };
    if (!addresses.length) return 'No verified saved delivery addresses. Type "deliver to <full street address>" to search and choose one here.';
    return `${addresses.map((address, i) => `${i + 1}. ${address.addressLine}`).join('\n')}\nType "use address 1" to select one, then "checkout".`;
  }
  const query = /^deliver to\s+(.+)$/i.exec(text);
  if (query) {
    if (query[1].length > 500) return 'Use a street address under 500 characters.';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let results: GeoResult[];
    try { results = await searchAddresses(query[1], controller.signal); }
    finally { clearTimeout(timer); }
    assertOwner();
    const valid = results.filter(location => !deliveryLocationProblem(location));
    choices = { generation, values: valid.slice(0, 6).map(location => ({ location })) };
    if (!valid.length) return 'No verified address in the delivery area matched. Type "deliver to <full street address and city>" to try again.';
    return `${choices.values.map(({ location }, i) => `${i + 1}. ${location.label}`).join('\n')}\nVerify the destination, then type "use address 1" (or another number). No address has been saved yet.`;
  }
  const selection = /^use address\s+([1-6])$/i.exec(text);
  if (selection) {
    const value = choices?.generation === generation ? choices.values[Number(selection[1]) - 1] : undefined;
    if (!value) return 'Type "addresses" or "deliver to <full street address>" first, then choose a listed number.';
    let id = value.id;
    if (!id) {
      await useAddressStore.getState().save({ addressLine: value.location.addressLine,
        postalCode: value.location.postalCode, latitude: value.location.latitude, longitude: value.location.longitude });
      assertOwner();
      id = useAddressStore.getState().allAddresses.find(address => address.addressLine === value.location.addressLine
        && address.latitude === value.location.latitude && address.longitude === value.location.longitude)?.id;
    }
    const address = useAddressStore.getState().allAddresses.find(address => address.id === id);
    if (!address || deliveryLocationProblem(address)) return 'That address is no longer available. Type "addresses" to select again.';
    useGoerStore.getState().setChatAddressId(address.id);
    choices = null;
    return `Delivery set to ${value.location.label}. Type "checkout" to review the total and authorize payment.`;
  }
  return 'Checkout commands: "checkout", "addresses", "deliver to <address>", "use address 1", "tip $2.00", or "cancel checkout". Payment requires the exact confirmation shown with your current summary.';
}
