// Account deletion — a Google Play requirement for any app that offers sign-up.
//
// Three parts, and the local part always runs:
//   * Goer — DELETE /v1/me/data removes Goer's conversations and turn journal.
//   * Server — DELETE /account anonymizes this customer's orders, removes their
//     chat messages, and closes the Supabase account (which cascades their
//     profile row and push token). See backend/app/routers/account.py.
//   * Device — clears their orders, addresses, saved cards, and chat history
//     from AsyncStorage.
//
// In demo mode (no backend configured) there is no server account to close, so
// the local wipe *is* the deletion and this still succeeds.
import { API_URL, isBackendConfigured } from './api';
import { clearUserData } from './storage';
import { supabase } from './supabase';

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/**
 * Deletes the signed-in account. The caller is responsible for signing out and
 * routing away afterwards — this does not touch app state.
 */
export async function deleteAccount(email: string | null): Promise<DeleteAccountResult> {
  if (!email) return { ok: false, error: 'You need to be signed in to delete your account.' };

  if (isBackendConfigured && supabase) {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    // A real Supabase session is the only thing that proves who is asking. No
    // token means nothing server-side can be deleted safely, so fail loudly
    // rather than wiping the device and leaving the account alive.
    if (!accessToken) {
      return { ok: false, error: 'Your session has expired. Sign in again and retry.' };
    }

    // Goer's own conversation journal is separate from LocalGo's database, so
    // delete it first, while the session that proves ownership is still valid.
    const goerUrl = process.env.EXPO_PUBLIC_GOER_API_URL?.replace(/\/+$/, '');
    if (goerUrl) {
      try {
        const goer = await fetch(`${goerUrl}/v1/me/data`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!goer.ok) {
          return { ok: false, error: 'We could not delete your Goer chat data. Nothing was deleted; please try again.' };
        }
      } catch {
        return { ok: false, error: 'We could not reach Goer to delete your chat data. Nothing was deleted; please try again.' };
      }
    }

    try {
      const res = await fetch(`${API_URL}/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        const detail = await res
          .json()
          .then((body) => (typeof body?.detail === 'string' ? body.detail : null))
          .catch(() => null);
        return { ok: false, error: detail ?? 'We could not delete your account. Please try again.' };
      }
    } catch {
      return {
        ok: false,
        error: 'We could not reach the server. Check your connection and try again.',
      };
    }
  }

  // Only after the server confirms — otherwise a failed call would leave the
  // account alive with no local trace that it exists.
  await clearUserData(email);
  return { ok: true };
}
