"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Bot, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { getAccessToken, signOut } from "@/lib/supabase/auth-client";

interface AiAdminRow {
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
  sources_count: number;
  summary: string;
  analysis_mode: string;
  provider: string | null;
}

type AuthState = "loading" | "authed" | "forbidden" | "unauthed";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("uk-UA");
}

export default function AdminAiAnalysisPage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [rows, setRows] = useState<AiAdminRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(token: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-analysis", {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
      if (res.status === 401) {
        setAuthState("unauthed");
        router.replace("/login");
        return;
      }
      if (res.status === 403) {
        setAuthState("forbidden");
        return;
      }
      const data = await res.json() as { rows?: AiAdminRow[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Не вдалося завантажити AI analysis.");
        return;
      }
      setRows(data.rows ?? []);
    } catch {
      setError("Немає зʼєднання з сервером.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    async function check() {
      const token = await getAccessToken();
      if (!mounted) return;
      if (!token) {
        setAuthState("unauthed");
        router.replace("/login");
        return;
      }
      setAccessToken(token);
      setAuthState("authed");
      await load(token);
    }
    void check();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function logout() {
    await signOut();
    router.push("/login");
  }

  if (authState === "loading") {
    return <div className="container-page py-10 text-sm text-ink-muted">Завантаження…</div>;
  }

  if (authState === "forbidden") {
    return (
      <div className="container-page max-w-md py-12">
        <Card className="space-y-4 p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
          <h1 className="font-display text-xl font-bold text-ink">Доступ заборонено</h1>
          <p className="text-sm text-ink-soft">Ваш email не додано до admin_users.</p>
          <Button onClick={() => void logout()} variant="outline">
            <LogOut className="h-4 w-4" /> Вийти
          </Button>
        </Card>
      </div>
    );
  }

  if (!accessToken) return null;

  return (
    <div className="container-page space-y-6 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <Bot className="h-3.5 w-3.5" /> Адмінка
          </p>
          <h1 className="font-display text-2xl font-bold text-ink">AI-аналізи</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Історія безкоштовних AI/fallback аналізів. Це не відгуки і не впливає на рейтинги.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href="/admin" variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" /> До адмінки
          </Button>
          <Button onClick={() => void load(accessToken)} variant="secondary" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Оновити
          </Button>
          <Button onClick={() => void logout()} variant="ghost" size="sm">
            <LogOut className="h-4 w-4" /> Вийти
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </Card>
      )}

      <div className="grid gap-3">
        {rows.length === 0 ? (
          <Card className="p-6 text-sm text-ink-soft">
            AI-аналізів поки немає.
          </Card>
        ) : rows.map((row) => (
          <Card key={row.id} className="space-y-3 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-ink-muted">{formatDate(row.created_at)}</p>
                <h2 className="mt-1 font-semibold text-ink">
                  {row.analysis_type} · {row.company_name ?? row.company_slug ?? "Компанію не визначено"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-ink/[0.04] px-3 py-1 text-ink-soft">
                  risk: {row.risk_level ?? "unknown"} {row.risk_score ?? ""}
                </span>
                <span className="rounded-full bg-ink/[0.04] px-3 py-1 text-ink-soft">
                  mode: {row.analysis_mode}
                </span>
                {row.provider && (
                  <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-700">
                    provider: {row.provider}
                  </span>
                )}
                <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-700">
                  sources: {row.sources_count}
                </span>
                <span className="rounded-full bg-ink/[0.04] px-3 py-1 text-ink-soft">
                  {row.user_id ? "user" : "anonymous"}
                </span>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-ink-soft">{row.summary || "Summary не збережено."}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              <span>fetch: {row.fetch_status ?? "not_requested"}</span>
              <span>confidence: {row.confidence_level ?? "unknown"}</span>
              {row.input_url && (
                <a
                  href={row.input_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand-700 hover:text-brand-800"
                >
                  URL <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
