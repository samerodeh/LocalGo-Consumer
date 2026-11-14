import { supabase } from './supabase';

export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
  if (!data.session?.access_token) throw new Error('Sign in to continue.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` };
}
