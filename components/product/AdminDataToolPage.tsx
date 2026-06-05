"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getAccessToken, signOut } from "@/lib/supabase/auth-client";
import { AdminCompanyDiscoverySection } from "@/components/product/AdminCompanyDiscoverySection";
import { AdminCompanyOpenFactsSection } from "@/components/product/AdminCompanyOpenFactsSection";

type AdminToolKind = "company-discovery" | "open-facts";
type AuthState = "loading" | "authed" | "forbidden" | "unauthed";

const TOOL_COPY: Record<AdminToolKind, { title: string; description: string }> = {
  "company-discovery": {
    title: "Нові компанії з відкритих джерел",
    description: "Перевірка company_discovery_queue без створення відгуків або рейтингів.",
  },
  "open-facts": {
    title: "Дані з відкритих вакансій",
    description: "Модерація company_open_facts. Публікація тільки після явної дії адміністратора.",
  },
};

export function AdminDataToolPage({ tool }: { tool: AdminToolKind }) {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const copy = TOOL_COPY[tool];

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      const token = await getAccessToken();
      if (!token) {
        if (mounted) setAuthState("unauthed");
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/admin/reviews", {
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
      if (!mounted) return;
      if (res.ok) {
        setAccessToken(token);
        setAuthState("authed");
      } else if (res.status === 403) {
        setAuthState("forbidden");
      } else {
        setAuthState("unauthed");
        router.replace("/login");
      }
    }

    void checkAuth();
    return () => { mounted = false; };
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
            <ShieldCheck className="h-3.5 w-3.5" /> Адмінка
          </p>
          <h1 className="font-display text-2xl font-bold text-ink">{copy.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">{copy.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href="/admin" variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" /> До адмінки
          </Button>
          <Button onClick={() => void logout()} variant="ghost" size="sm">
            <LogOut className="h-4 w-4" /> Вийти
          </Button>
        </div>
      </div>

      {tool === "company-discovery" ? (
        <AdminCompanyDiscoverySection accessToken={accessToken} />
      ) : (
        <AdminCompanyOpenFactsSection accessToken={accessToken} />
      )}
    </div>
  );
}
