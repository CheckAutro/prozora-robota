"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { signUpWithEmail } from "@/lib/supabase/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [email,           setEmail]           = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error,           setError]           = useState<string | null>(null);
  const [success,         setSuccess]         = useState(false);
  const [loading,         setLoading]         = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimEmail = email.trim();
    if (!trimEmail || !password) {
      setError("Введіть email та пароль.");
      return;
    }
    if (password.length < 8) {
      setError("Пароль повинен містити мінімум 8 символів.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Паролі не збігаються.");
      return;
    }

    setLoading(true);
    const { needsConfirmation, error: signUpError } = await signUpWithEmail(trimEmail, password);
    setLoading(false);

    if (signUpError) {
      setError(signUpError);
      return;
    }

    if (needsConfirmation) {
      setSuccess(true);
    } else {
      // Email confirmation disabled — session already active, go to admin
      // (access will be granted only if email is in admin_users)
      router.push("/admin");
    }
  }

  const inputCls =
    "w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-sm focus-ring placeholder:text-ink-muted/60";

  if (success) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="flex justify-center">
            <CheckCircle2 className="h-12 w-12 text-brand-600" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Акаунт створено</h1>
            <p className="mt-2 text-sm text-ink-soft">
              Перевірте email для підтвердження входу. Після підтвердження зверніться до
              адміністратора для отримання доступу до кабінету.
            </p>
          </div>
          <Button href="/login" variant="secondary">
            Перейти до входу
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Створити акаунт</h1>
            <p className="mt-1 text-sm text-ink-soft">
              Створіть акаунт для доступу до кабінету. Адміністративний доступ
              надається лише після додавання email до списку адміністраторів.
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
                placeholder="your@email.com"
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
                placeholder="Мінімум 8 символів"
                autoComplete="new-password"
                required
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-ink" htmlFor="confirm">
                Підтвердіть пароль
              </label>
              <input
                id="confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Повторіть пароль"
                autoComplete="new-password"
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
                <><Loader2 className="h-4 w-4 animate-spin" /> Реєстрація…</>
              ) : (
                "Зареєструватися"
              )}
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-ink-muted">
          Вже маєте акаунт?{" "}
          <a href="/login" className="text-brand-700 hover:underline">
            Увійти
          </a>
        </p>
      </div>
    </div>
  );
}
