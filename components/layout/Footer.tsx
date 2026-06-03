import Link from "next/link";
import { ShieldCheck } from "lucide-react";

const COLS = [
  {
    title: "Сервіс",
    links: [
      { href: "/companies", label: "Компанії" },
      { href: "/check-vacancy", label: "Перевірити вакансію" },
      { href: "/check-job",     label: "Аналіз вакансії" },
      { href: "/add-review", label: "Додати відгук" },
    ],
  },
  {
    title: "Про нас",
    links: [
      { href: "/about",       label: "Про проєкт" },
      { href: "/for-employers", label: "Роботодавцям" },
      { href: "/privacy",     label: "Конфіденційність" },
      { href: "/terms",       label: "Умови користування" },
      { href: "/contact",     label: "Контакти" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-ink/[0.06] bg-white">
      <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <span className="font-display text-base font-bold text-ink">Прозора робота</span>
          </div>
          <p className="max-w-sm text-sm text-ink-soft">
            Анонімні відгуки про роботодавців в Україні. Перевірте зарплату, оформлення та
            бронювання ще до співбесіди.
          </p>
          <p className="text-xs text-ink-muted">
            Відгуки публікуються анонімно після модерації. Оцінки не є юридичним висновком.
          </p>
        </div>

        {COLS.map((col) => (
          <div key={col.title} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {col.title}
            </h3>
            <ul className="space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-sm text-ink-soft transition-colors hover:text-brand-700"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-ink/[0.06]">
        <div className="container-page py-5 text-xs text-ink-muted">
          © {new Date().getFullYear()} Прозора робота. Анонімні відгуки про роботодавців в Україні.
        </div>
      </div>
    </footer>
  );
}
