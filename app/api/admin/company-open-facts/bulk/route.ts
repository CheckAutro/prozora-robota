// POST /api/admin/company-open-facts/bulk
// Bulk moderation for company_open_facts only. Never touches reviews or ratings.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";

type OpenFactsBulkAction =
  | "mark_verified"
  | "mark_needs_verification"
  | "make_public"
  | "make_private"
  | "reject";

const VALID_ACTIONS = new Set<OpenFactsBulkAction>([
  "mark_verified",
  "mark_needs_verification",
  "make_public",
  "make_private",
  "reject",
]);

interface BulkError {
  id: string;
  error: string;
}

function stringIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function actionUpdate(action: OpenFactsBulkAction): Record<string, unknown> {
  if (action === "mark_verified") return { status: "verified" };
  if (action === "mark_needs_verification") return { status: "needs_verification", is_public: false };
  if (action === "make_private") return { is_public: false };
  if (action === "reject") return { status: "rejected", is_public: false };
  return { is_public: true };
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

  const action = String(body.action ?? "") as OpenFactsBulkAction;
  const ids = stringIds(body.ids);
  if (!VALID_ACTIONS.has(action)) return NextResponse.json({ error: "Invalid action" }, { status: 422 });
  if (ids.length === 0) return NextResponse.json({ error: "ids are required" }, { status: 422 });
  if (ids.length > 500) return NextResponse.json({ error: "Bulk limit is 500 rows" }, { status: 422 });

  const client = getServiceClient();
  const errors: BulkError[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  const { data: rows, error: loadError } = await client
    .from("company_open_facts")
    .select("id, status")
    .in("id", ids);

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });

  const rowsById = new Map((rows ?? []).map((row) => [String(row.id), row as { id: string; status?: string }]));
  const update = actionUpdate(action);

  for (const id of ids) {
    const row = rowsById.get(id);
    if (!row) {
      skippedCount += 1;
      errors.push({ id, error: "not found" });
      continue;
    }

    if (action === "make_public" && row.status !== "verified") {
      skippedCount += 1;
      errors.push({ id, error: "make_public requires status=verified" });
      continue;
    }

    const { error } = await client.from("company_open_facts").update(update).eq("id", id);
    if (error) {
      skippedCount += 1;
      errors.push({ id, error: error.message });
    } else {
      updatedCount += 1;
    }
  }

  return NextResponse.json({ ok: true, updated_count: updatedCount, skipped_count: skippedCount, errors });
}
