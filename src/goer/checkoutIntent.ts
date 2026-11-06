// Recognizes a request to see the checkout summary, including inside a normal
// sentence ("I added the address, checkout my order now"). This is safe to be
// generous about: the summary never charges. Payment still needs the exact
// `CONFIRM ORDER <code>` shown with the current summary.
const exact = /^(?:please )?(?:check ?out|place (?:my |the )?order|order now|ready to order|pay)(?: please)?[.!]?$/i;
const phrase = /\b(?:check ?out|place (?:my |the |our )?order|order (?:it )?now|ready to order|complete (?:my |the )?order|finish (?:my |the )?order)\b/i;
// Questions about checkout ("how does checkout work?") go to the assistant.
const question = /^(?:how|what|why|when|where|which|does|do|is|are)\b/i;

export function isCheckoutRequest(text: string): boolean {
  const value = text.trim();
  if (exact.test(value)) return true;
  if (value.length > 160 || question.test(value) || /\bcancel\b/i.test(value)) return false;
  return phrase.test(value);
}
