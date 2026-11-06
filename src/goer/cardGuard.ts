// Payment-card data must never be typed into chat: it would be displayed,
// sent to Goer and saved in cloud chat history. Card entry belongs only in
// Stripe's payment form. Goer's API applies the same check as a backstop.
const cardCandidate = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
const securityCode = /\b(?:cvv2?|cvc2?|cid|security code)\b(?:\s*(?:is|:|=|#|-))?\s*\d{3,4}\b/i;

export const CARD_REFUSAL =
  "For your security, please don't type card numbers or security codes in chat. " +
  "That message wasn't sent or saved. Payment details are only entered in the secure " +
  'Stripe payment form after you confirm checkout.';

function luhnValid(digits: string): boolean {
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    let value = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    total += value;
  }
  return total % 10 === 0;
}

export function containsPaymentCardData(text: string): boolean {
  if (securityCode.test(text)) return true;
  for (const match of text.matchAll(cardCandidate)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return true;
  }
  return false;
}
