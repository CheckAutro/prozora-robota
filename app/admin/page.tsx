"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Inbox, CheckCircle2, XCircle, PenLine, RefreshCw,
  Lock, LogOut, AlertCircle, Ban,
} from "lucide-react";
import { signOut, getAccessToken } from "@/lib/supabase/auth-client";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminReviewCard } from "@/components/product/AdminReviewCard";
import { AdminSignalsSection } from "@/components/product/AdminSignalsSection";
import { AdminExternalRatingsSection } from "@/components/product/AdminExternalRatingsSection";
import { AdminExternalReviewSignalsSection } from "@/components/product/AdminExternalReviewSignalsSection";
import { AdminCompanyOpenFactsSection } from "@/components/product/AdminCompanyOpenFactsSection";
import { AdminCompanyDiscoverySection } from "@/components/product/AdminCompanyDiscoverySection";
import type { Review, ReviewStatus } from "@/lib/types";

// ── Auth helpers ──────────────────────────────────────────────────────────────

// Legacy key — kept for fallback while migrating to Supabase Auth
const LEGACY_KEY = "admin_key";

/**
 * Builds headers for admin API calls.
 * Primary: Supabase Auth Bearer token from the live browser session.
 *   Supabase stores this automatically after signInWithPassword — no manual
 *   sessionStorage needed.
 * Fallback: legacy x-admin-key (backward compat).
 */
async function getAdminHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  if (token) {
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
  }
  const key = (() => {
    try { return sessionStorage.getItem(LEGACY_KEY) ?? ""; } catch { return ""; }
  })();
  return { "x-admin-key": key, "content-type": "application/json" };
}

// ── Status counter config ─────────────────────────────────────────────────────

const STAT_META: { status: ReviewStatus; label: string; icon: typeof Inbox; accent: string }[] = [
  { status: "pending",    label: "На модерації",           icon: Inbox,        accent: "text-brand-700" },
  { status: "published",  label: "Опубліковані",           icon: CheckCircle2, accent: "text-brand-700" },
  { status: "rejected",   label: "Відхилені",              icon: XCircle,      accent: "text-red-700"   },
  { status: "needs_edit", label: "Потребують редагування", icon: PenLine,      accent: "text-amber-700" },
];

// ── Legacy login form (x-admin-key fallback) ──────────────────────────────────

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [key, setKey]         = useState("");
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reviews", {
        headers: { "x-admin-key": trimmed },
      });
      if (res.ok) {
        try { sessionStorage.setItem(LEGACY_KEY, trimmed); } catch { /* ignore */ }
        onSuccess();
      } else if (res.status === 401) {
        setError("Невірний ключ доступу.");
      } else if (res.status === 500) {
        setError("Помилка сервера. Перевірте налаштування Supabase.");
      } else {
        setError("Не вдалося перевірити ключ. Спробуйте ще раз.");
      }
    } catch {
      setError("Немає зʼєднання з сервером.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container-page max-w-md py-12 sm:py-16">
      <Card className="space-y-5 p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100">
          <Lock className="h-6 w-6 text-brand-700" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Доступ до модерації</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Введіть ключ доступу адміністратора або{" "}
            <a href="/login" className="text-brand-700 underline hover:text-brand-800">
              увійдіть через email
            </a>.
          </p>
        </div>
        <div className="space-y-1.5">
          <input
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && !loading && void submit()}
            placeholder="Ключ доступу"
            className="w-full rounded-xl border border-ink/12 bg-white px-3.5 py-2.5 text-sm focus-ring"
            disabled={loading}
          />
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>
        <Button onClick={() => void submit()} size="lg" disabled={loading} className="w-full sm:w-auto">
          {loading ? "Перевірка…" : "Увійти"}
        </Button>
      </Card>
    </div>
  );
}

// ── Main admin page ───────────────────────────────────────────────────────────

type AuthState = "loading" | "unauthed" | "forbidden" | "authed";

export default function AdminPage() {
  const router = useRouter();
  const [authState,   setAuthState]   = useState<AuthState>("loading");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [pending,     setPending]     = useState<Review[]>([]);
  const [counts,      setCounts]      = useState<Record<ReviewStatus, number>>({
    pending: 0, published: 0, rejected: 0, needs_edit: 0,
  });

  // ── Initial auth check ────────────────────────────────────────────────────
  // Try Supabase session first. If no session, check legacy key.
  // We gate all API calls behind this check to prevent premature 401s.
  useEffect(() => {
    async function checkAuth() {
      const token = await getAccessToken();
      if (process.env.NODE_ENV === "development") {
        console.log("[admin] auth checked", true);
        console.log("[admin] token exists", Boolean(token));
      }
      if (token) {
        // Verify the token is actually an admin by pinging the API
        if (process.env.NODE_ENV === "development") {
          console.log("[admin] fetching reviews with auth", Boolean(token));
        }
        const res = await fetch("/api/admin/reviews", {
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json() as { reviews: Review[]; counts: Record<ReviewStatus, number> };
          setPending(data.reviews);
          setCounts(data.counts);
          setAccessToken(token);
          setAuthState("authed");
        } else if (res.status === 403) {
          setAuthState("forbidden");
        } else {
          // 401 or other — session invalid or expired
          setAuthState("unauthed");
        }
        return;
      }

      // No Supabase session — check legacy key
      const legacyKey = (() => {
        try { return sessionStorage.getItem(LEGACY_KEY); } catch { return null; }
      })();
      if (legacyKey) {
        const res = await fetch("/api/admin/reviews", {
          headers: { "x-admin-key": legacyKey },
        });
        if (res.ok) {
          const data = await res.json() as { reviews: Review[]; counts: Record<ReviewStatus, number> };
          setPending(data.reviews);
          setCounts(data.counts);
          // Legacy path — no Bearer token, keep null
          setAuthState("authed");
          return;
        }
      }

      // Nothing worked — redirect to login
      router.replace("/login");
    }

    void checkAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Refresh pending reviews ───────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAdminHeaders();
      const res = await fetch("/api/admin/reviews", { headers });
      if (res.status === 401) {
        setError("Сесія завершилась. Увійдіть повторно.");
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        setError("Доступ заборонено. Email не додано до admin_users.");
        setAuthState("forbidden");
        return;
      }
      if (!res.ok) {
        setError("Помилка завантаження даних. Перевірте налаштування Supabase.");
        return;
      }
      const data = await res.json() as { reviews: Review[]; counts: Record<ReviewStatus, number> };
      setPending(data.reviews);
      setCounts(data.counts);
    } catch {
      setError("Немає зʼєднання з сервером.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  // ── Handle review status change ───────────────────────────────────────────
  async function handleMove(id: string, to: ReviewStatus) {
    try {
      const headers = await getAdminHeaders();
      await fetch(`/api/admin/reviews/${id}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: to }),
      });
    } catch (err) {
      console.error("[admin] handleMove exception:", err);
    }
    void refresh();
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async function logout() {
    await signOut();
    try {
      sessionStorage.removeItem(LEGACY_KEY);
    } catch { /* ignore */ }
    router.push("/login");
  }

  // ── Render states ─────────────────────────────────────────────────────────

  if (authState === "loading") {
    return <div className="container-page py-10 text-ink-muted">Завантаження…</div>;
  }

  if (authState === "unauthed") {
    return <AdminLogin onSuccess={() => { setAuthState("authed"); void refresh(); }} />;
  }

  if (authState === "forbidden") {
    async function switchAccount() {
      await logout();
    }
    return (
      <div className="container-page max-w-md py-12">
        <Card className="space-y-5 p-8 text-center">
          <Ban className="mx-auto h-10 w-10 text-red-400" />
          <h1 className="font-display text-xl font-bold text-ink">Доступ заборонено</h1>
          <p className="text-sm text-ink-soft">
            Ваш email не додано до списку адміністраторів. Зверніться до власника
            сервісу або увійдіть з іншим акаунтом.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => void switchAccount()} variant="primary">
              <LogOut className="h-4 w-4" /> Увійти іншим акаунтом
            </Button>
            <Button href="/register" variant="secondary">
              Створити акаунт
            </Button>
            <Button onClick={() => void logout()} variant="ghost" className="text-ink-muted">
              Вийти
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // authState === "authed"
  return (
    <div className="container-page space-y-8 py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle
          eyebrow="Адмінка"
          title="Модерація відгуків"
          description="Відгуки зберігаються у Supabase. Модерація виконується через захищений серверний API."
        />
        <div className="flex items-center gap-2">
          <Button href="/admin/company-discovery" variant="outline" size="sm">
            Нові компанії
          </Button>
          <Button href="/admin/open-facts" variant="outline" size="sm">
            Open facts
          </Button>
          <Button href="/admin/ai-analysis" variant="outline" size="sm">
            AI-аналізи
          </Button>
          <Button onClick={() => void refresh()} variant="secondary" size="sm" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Оновити
          </Button>
          <Button onClick={() => void logout()} variant="outline" size="sm">
            <LogOut className="h-4 w-4" /> Вийти
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STAT_META.map(({ status, label, icon: Icon, accent }) => (
          <Card key={status} className="p-4">
            <div className="flex items-center gap-2 text-ink-muted">
              <Icon className={`h-4 w-4 ${accent}`} />
              <span className="text-xs font-medium">{label}</span>
            </div>
            <p className={`mt-2 font-display text-3xl font-bold tnum ${accent}`}>
              {counts[status]}
            </p>
          </Card>
        ))}
      </div>

      {/* Pending reviews */}
      <section className="space-y-4">
        <h2 className="font-display text-lg font-bold text-ink">Відгуки на модерації</h2>
        {loading && pending.length === 0 ? (
          <p className="text-sm text-ink-muted">Завантаження…</p>
        ) : pending.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="Немає відгуків на модерації"
            description="Залиште відгук на сторінці «Додати відгук», і він з'явиться тут зі статусом «на модерації»."
            action={<Button href="/add-review">Додати тестовий відгук</Button>}
          />
        ) : (
          <div className="space-y-4">
            {pending.map((review) =>
              accessToken ? (
                <AdminReviewCard
                  key={review.id}
                  review={review}
                  accessToken={accessToken}
                  onPublish={() => void handleMove(review.id, "published")}
                  onReject={() => void handleMove(review.id, "rejected")}
                  onNeedsEdit={() => void handleMove(review.id, "needs_edit")}
                />
              ) : null
            )}
          </div>
        )}
      </section>

      {/* External ratings */}
      <div className="border-t border-ink/[0.06] pt-8">
        {accessToken && <AdminExternalRatingsSection accessToken={accessToken} />}
      </div>

      {/* External review signals */}
      <div className="border-t border-ink/[0.06] pt-8">
        {accessToken && <AdminExternalReviewSignalsSection accessToken={accessToken} />}
      </div>

      {/* New company discovery */}
      <div className="border-t border-ink/[0.06] pt-8">
        {accessToken && <AdminCompanyDiscoverySection accessToken={accessToken} />}
      </div>

      {/* Open vacancy facts */}
      <div className="border-t border-ink/[0.06] pt-8">
        {accessToken && <AdminCompanyOpenFactsSection accessToken={accessToken} />}
      </div>

      {/* External signals */}
      <div className="border-t border-ink/[0.06] pt-8">
        {accessToken && <AdminSignalsSection accessToken={accessToken} />}
      </div>
    </div>
  );
}
