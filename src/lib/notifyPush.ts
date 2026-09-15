// Fire-and-forget call to the FastAPI backend's `/notify` endpoint (the
// Python port of the old `notify-push` edge function). Recipients are derived
// server-side from the order row — this call only says what happened. Never
// throws or blocks its caller, same convention as dispatch.ts.
import { API_URL, isBackendConfigured } from './api';

/** Every kind the backend can send. The app only ever *sends* 'new_message'
 *  (from chatStore); the rest arrive as pushes and are listed here so the tap
 *  handler in app/_layout.tsx can route on them. */
export type NotifyKind =
  | 'new_order'
  | 'order_accepted'
  | 'order_picked_up'
  | 'order_nearby'
  | 'order_arrived'
  | 'order_delivered'
  | 'new_message';

/** The delivery-progress pushes. Tapping one of these should open the order,
 *  not the chat — which is what it did before these kinds were named here. */
export const ORDER_PROGRESS_KINDS: readonly NotifyKind[] = [
  'order_accepted',
  'order_picked_up',
  'order_nearby',
  'order_arrived',
  'order_delivered',
];

export async function notifyPush(
  orderId: string,
  kind: NotifyKind,
  extra?: { senderId?: string; preview?: string },
): Promise<void> {
  if (!isBackendConfigured || !API_URL) return;

  try {
    await fetch(`${API_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, kind, ...extra }),
    });
  } catch (err) {
    console.warn('[notifyPush] failed:', err);
  }
}
