import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";

interface AiAnalysisRow {
  id: string;
  created_at: string;
  analysis_type: string;
  company_name: string | null;
  company_slug: string | null;
  risk_level: string | null;
  risk_score: number | null;
  confidence_level: string | null;
  user_id: string | null;
  anonymous_id: string | null;
  input_url: string | null;
  fetch_status: string | null;
  sources_json: unknown;
  result_json: Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("ai_analysis_requests")
      .select("id, created_at, analysis_type, company_name, company_slug, risk_level, risk_score, confidence_level, user_id, anonymous_id, input_url, fetch_status, sources_json, result_json")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = ((data ?? []) as AiAnalysisRow[]).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      analysis_type: row.analysis_type,
      company_name: row.company_name,
      company_slug: row.company_slug,
      risk_level: row.risk_level,
      risk_score: row.risk_score,
      confidence_level: row.confidence_level,
      user_id: row.user_id,
      anonymous_id: row.anonymous_id,
      input_url: row.input_url,
      fetch_status: row.fetch_status,
      sources_count: Array.isArray(row.sources_json) ? row.sources_json.length : 0,
      summary: typeof row.result_json?.summary === "string" ? row.result_json.summary : "",
    }));

    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
