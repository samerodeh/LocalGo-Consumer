import { authHeaders } from './authHeaders';
// Fire-and-forget call to the FastAPI backend's `/notify` endpoint (the
// Python port of the old `notify-push` edge function). Recipients are derived
// server-side from the order row — this call only says what happened. Never
// throws or blocks its caller, same convention as dispatch.ts.
import { API_URL, isBackendConfigured } from './api';

export type NotifyKind = 'new_order' | 'order_accepted' | 'new_message';

export async function notifyPush(
  orderId: string,
  kind: NotifyKind,
  extra?: { senderId?: string; preview?: string },
): Promise<void> {
  if (!isBackendConfigured || !API_URL) return;

  try {
    await fetch(`${API_URL}/notify`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ orderId, kind, ...extra }),
    });
  } catch (err) {
    console.warn('[notifyPush] failed:', err);
  }
}
