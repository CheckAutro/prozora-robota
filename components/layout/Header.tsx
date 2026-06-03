"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { getBrowserClient } from "@/lib/supabase/client";
import { signOut } from "@/lib/supabase/auth-client";

const NAV = [
  { href: "/companies", label: "Компанії" },
  { href: "/check-vacancy", label: "Перевірити вакансію" },
  { href: "/about", label: "Про проєкт" },
  { href: "/for-employers", label: "Роботодавцям" },
];

function AuthHeaderActions({
  layout,
  onNavigate,
}: {
  layout: "desktop" | "mobile";
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    try {
      const supabase = getBrowserClient();

      async function loadSession() {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setIsAuthed(Boolean(data.session));
        setReady(true);
      }

      void loadSession();

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!mounted) return;
        setIsAuthed(Boolean(session));
        setReady(true);
      });

      unsubscribe = () => listener.subscription.unsubscribe();
    } catch {
      // If Supabase is not configured, keep the public logged-out header.
    }

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    setIsAuthed(false);
    onNavigate?.();
    router.push("/login");
  }

  const authed = ready && isAuthed;
  const size = layout === "mobile" ? "md" : "sm";
  const buttonClass = layout === "mobile" ? "justify-center" : undefined;

  return (
    <div
      className={cn(
        layout === "desktop"
          ? "hidden items-center gap-2 md:flex"
          : "mt-2 grid grid-cols-2 gap-2"
      )}
    >
      <Button
        href={authed ? "/admin" : "/login"}
        variant="outline"
        size={size}
        className={buttonClass}
        onClick={onNavigate}
      >
        {authed ? "Кабінет" : "Вхід"}
      </Button>
      {authed && (
        <Button
          type="button"
          variant="ghost"
          size={size}
          className={buttonClass}
          onClick={() => void handleSignOut()}
        >
          Вийти
        </Button>
      )}
      <Button
        href="/add-review"
        size={size}
        className={cn(buttonClass, layout === "mobile" && authed && "col-span-2")}
        onClick={onNavigate}
      >
        Додати відгук
      </Button>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-ink/[0.06] bg-canvas/85 backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 focus-ring rounded-lg" onClick={() => setOpen(false)}>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-ink">
            Прозора робота
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-ring",
                pathname.startsWith(item.href)
                  ? "text-brand-700 bg-brand-50"
                  : "text-ink-soft hover:text-ink hover:bg-ink/[0.04]"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <AuthHeaderActions layout="desktop" />

        <button
          className="md:hidden flex h-10 w-10 items-center justify-center rounded-lg text-ink focus-ring"
          onClick={() => setOpen((v) => !v)}
          aria-label="Меню"
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-ink/[0.06] bg-canvas md:hidden">
          <nav className="container-page flex flex-col gap-1 py-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-sm font-medium",
                  pathname.startsWith(item.href)
                    ? "text-brand-700 bg-brand-50"
                    : "text-ink-soft hover:bg-ink/[0.04]"
                )}
              >
                {item.label}
              </Link>
            ))}
            <AuthHeaderActions layout="mobile" onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      )}
    </header>
  );
}
