// POST /api/admin/company-discovery/bulk
// Bulk actions for company_discovery_queue only. Never touches reviews or ratings.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import { createCompanyFromDiscovery } from "@/lib/company-discovery-service";

type DiscoveryBulkAction = "reject" | "needs_review" | "create_safe";

const VALID_ACTIONS = new Set<DiscoveryBulkAction>([
  "reject",
  "needs_review",
  "create_safe",
]);

interface BulkError {
  id: string;
  error: string;
}

interface DiscoveryRow {
  id: string;
  discovered_name: string;
  suggested_slug: string;
  status: string;
  is_imported: boolean;
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "") as DiscoveryBulkAction;
  const ids = stringIds(body.ids);
  if (!VALID_ACTIONS.has(action)) return NextResponse.json({ error: "Invalid action" }, { status: 422 });
  if (ids.length === 0) return NextResponse.json({ error: "ids are required" }, { status: 422 });
  if (ids.length > 500) return NextResponse.json({ error: "Bulk limit is 500 rows" }, { status: 422 });

  const client = getServiceClient();
  const errors: BulkError[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  if (action === "reject" || action === "needs_review") {
    const status = action === "reject" ? "rejected" : "needs_review";
    const { data, error } = await client
      .from("company_discovery_queue")
      .update({ status, is_imported: false })
      .in("id", ids)
      .select("id");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updatedCount = data?.length ?? 0;
    skippedCount = ids.length - updatedCount;
    return NextResponse.json({ ok: true, updated_count: updatedCount, skipped_count: skippedCount, errors });
  }

  const { data: rows, error: loadError } = await client
    .from("company_discovery_queue")
    .select("id, discovered_name, suggested_slug, status, is_imported")
    .in("id", ids);

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });

  const rowsById = new Map((rows ?? []).map((row) => [String(row.id), row as DiscoveryRow]));

  for (const id of ids) {
    const row = rowsById.get(id);
    if (!row) {
      skippedCount += 1;
      errors.push({ id, error: "not found" });
      continue;
    }
    if (row.status !== "needs_review" || row.is_imported) {
      skippedCount += 1;
      errors.push({ id, error: "only needs_review, not imported rows can be created" });
      continue;
    }
    if (!isSlug(row.suggested_slug)) {
      skippedCount += 1;
      errors.push({ id, error: "invalid suggested_slug" });
      continue;
    }

    const { data: existing, error: existingError } = await client
      .from("companies")
      .select("slug")
      .eq("slug", row.suggested_slug)
      .maybeSingle();
    if (existingError) {
      skippedCount += 1;
      errors.push({ id, error: existingError.message });
      continue;
    }
    if (existing) {
      skippedCount += 1;
      errors.push({ id, error: "suggested_slug already exists: " + row.suggested_slug });
      continue;
    }

    const result = await createCompanyFromDiscovery(id);
    if (result.ok) updatedCount += 1;
    else {
      skippedCount += 1;
      errors.push({ id, error: result.error });
    }
  }

  return NextResponse.json({ ok: true, updated_count: updatedCount, skipped_count: skippedCount, errors });
}
