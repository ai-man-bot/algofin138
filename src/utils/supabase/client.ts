import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from './info';

export const supabaseUrl = `https://${projectId}.supabase.co`;

let client: SupabaseClient | null = null;

/**
 * Shared browser Supabase client (anon key, user session storage).
 *
 * Callers should import this module lazily (`await import(...)`) so that
 * supabase-js stays out of the initial entry chunk: the app shell renders
 * immediately and auth bootstraps as soon as this chunk arrives.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl, publicAnonKey);
  }
  return client;
}
