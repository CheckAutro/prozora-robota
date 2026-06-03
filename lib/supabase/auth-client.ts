// lib/supabase/auth-client.ts
// Browser-side Supabase Auth helpers.
// Safe to import in "use client" components.

import { getBrowserClient } from "./client";

/** Sign in with email + password. Returns { token, error }. */
export async function signInWithEmail(
  email: string,
  password: string
): Promise<{ token: string | null; error: string | null }> {
  try {
    const client = getBrowserClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { token: null, error: error.message };
    return { token: data.session?.access_token ?? null, error: null };
  } catch (err) {
    return { token: null, error: err instanceof Error ? err.message : "Помилка входу" };
  }
}

/** Sign up with email + password. Returns { needsConfirmation, error }. */
export async function signUpWithEmail(
  email: string,
  password: string
): Promise<{ needsConfirmation: boolean; error: string | null }> {
  try {
    const client = getBrowserClient();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) return { needsConfirmation: false, error: error.message };
    // If session is present, email confirmation is disabled
    const hasSession = Boolean(data.session?.access_token);
    return { needsConfirmation: !hasSession, error: null };
  } catch (err) {
    return { needsConfirmation: false, error: err instanceof Error ? err.message : "Помилка реєстрації" };
  }
}

/** Sign out the current user. */
export async function signOut(): Promise<void> {
  try {
    const client = getBrowserClient();
    await client.auth.signOut();
  } catch {
    // ignore
  }
}

/**
 * Returns the current session access token, or null if not logged in.
 * Reads the Supabase-managed browser storage — no manual sessionStorage needed.
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const client = getBrowserClient();
    const { data, error } = await client.auth.getSession();
    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[auth-client] getSession error:", error.message);
      }
      return null;
    }
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
