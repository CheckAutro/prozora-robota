import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let _client: SupabaseClient | null = null;

/**
 * Browser-side Supabase singleton (anon key).
 * Throws a user-facing error if env vars are not configured so callers
 * can catch it and display a helpful message instead of a silent failure.
 */
export function getBrowserClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase не налаштовано. Додайте NEXT_PUBLIC_SUPABASE_URL та " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY у .env.local і перезапустіть сервер."
    );
  }
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _client;
}

/** Returns true if the browser Supabase client is configured. */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
