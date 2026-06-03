"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { signInWithEmail } from "@/lib/supabase/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimEmail = email.trim();
    if (!trimEmail || !password) {
      setError("Введіть email та пароль.");
      return;
    }
    setLoading(true);
    const { token, error: authError } = await signInWithEmail(trimEmail, password);
    setLoading(false);

    if (authError || !token) {
      setError(authError ?? "Не вдалося увійти. Перевірте email та пароль.");
      return;
    }

    // Supabase Auth stores the session automatically in browser storage.
    // No manual sessionStorage needed — getAccessToken() will find it.
    router.push("/admin");
  }

  const inputCls =
    "w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-sm focus-ring placeholder:text-ink-muted/60";

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">
              Вхід до кабінету
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              Увійдіть, щоб керувати модерацією та налаштуваннями сервісу.
            </p>
          </div>
        </div>

        {/* Form */}
        <Card className="p-6">
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                autoComplete="email"
                required
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink" htmlFor="password">
                Пароль
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className={inputCls}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full justify-center"
              disabled={loading}
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Входимо…</>
              ) : (
                "Увійти"
              )}
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-ink-muted">
          Увійдіть або{" "}
          <a href="/register" className="text-brand-700 hover:underline font-medium">
            створіть акаунт
          </a>
          , щоб перейти до кабінету.
        </p>

        <div className="text-center">
          <a
            href="/register"
            className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 px-4 py-2.5 text-sm font-medium text-ink-soft hover:border-brand-300 hover:text-brand-700"
          >
            Створити акаунт →
          </a>
        </div>
      </div>
    </div>
  );
}
