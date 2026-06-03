// Server-side Supabase clients — for Route Handlers and Server Components ONLY.
// Never import this file in "use client" code.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Anon client for server components that need to read public data. */
export function getServerClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createClient(url, key);
}

/**
 * Service-role client — bypasses all RLS policies.
 * Use ONLY in Route Handlers and Server Actions; never expose to the browser.
 * Requires SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix).
 */
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase service client not configured. " +
        "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
