// lib/supabase/auth-server.ts
// Server-side auth helpers for Route Handlers and Server Components.
// NEVER import in "use client" files.

import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "./server";

/**
 * Extracts the currently authenticated Supabase user from a request.
 * Reads the Authorization: Bearer <access_token> header.
 * Returns null when the token is absent or invalid.
 */
export async function getAuthUser(
  req: NextRequest
): Promise<{ id: string; email: string } | null> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) return null;

  try {
    // Use a fresh anon client to verify the JWT (standard Supabase pattern)
    const client = createClient(url, anonKey);
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[auth-server] getUser error:", error.message);
      }
      return null;
    }
    if (!data.user || !data.user.email) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}

/**
 * Checks whether an email belongs to an admin.
 * Queries public.admin_users via service-role (bypasses RLS).
 * Returns false on any error — fail closed.
 */
export async function isAdminUser(email: string): Promise<boolean> {
  if (!email) return false;
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("admin_users")
      .select("email")
      .eq("email", email.toLowerCase().trim())
      .maybeSingle();
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * Convenience helper: extracts user from request AND checks admin_users.
 * Returns { user, isAdmin } or null when unauthenticated.
 */
export async function requireAdmin(
  req: NextRequest
): Promise<
  | { ok: true;  user: { id: string; email: string } }
  | { ok: false; status: 401 | 403; error: string }
> {
  const user = await getAuthUser(req);

  if (!user) {
    // No valid Bearer token at all
    return { ok: false, status: 401, error: "Unauthorized — missing or invalid token" };
  }

  const admin = await isAdminUser(user.email);
  if (!admin) {
    // Valid user, but not in admin_users
    return { ok: false, status: 403, error: "Forbidden — email not in admin_users" };
  }

  return { ok: true, user };
}
