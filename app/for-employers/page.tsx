import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Check, X, MessageSquare, EyeOff, ShieldCheck, Scale } from "lucide-react";

export const metadata: Metadata = {
  title: "Для роботодавців — Прозора робота",
  description:
    "Що роботодавець може і не може робити на платформі «Прозора робота».",
};

const CAN = [
  "Підтвердити профіль компанії",
  "Відповісти на відгук від імені компанії",
  "Повідомити про фактичну помилку у даних",
  "Оновити інформацію про компанію",
  "Пояснити умови бронювання та оформлення",
];

const CANNOT = [
  "Отримати особу автора відгуку",
  "Купити видалення негативного відгуку",
  "Приховати скарги за гроші",
  "Впливати на рейтинг без прозорих підстав",
];

const PILLARS = [
  {
    icon: EyeOff,
    title: "Анонімність",
    text: "Особа автора ніколи не розкривається — ні роботодавцю, ні платформі.",
  },
  {
    icon: ShieldCheck,
    title: "Модерація",
    text: "Кожен відгук перевіряється перед публікацією — без персональних даних і образ.",
  },
  {
    icon: Scale,
    title: "Справедливість",
    text: "Рейтинг формується тільки на основі реальних відгуків. Купити або приховати — неможливо.",
  },
];

export default function ForEmployersPage() {
  return (
    <div className="container-page max-w-3xl space-y-12 py-8 sm:py-10">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-50/60 to-white p-7 sm:p-10">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">
          Для роботодавців
        </p>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Прозора робота — не майданчик для реклами
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
          Ми за чесний діалог: компанія може реагувати на відгуки і уточнювати дані,
          але не може купувати рейтинг чи розкривати авторів.
        </p>
      </div>

      {/* ── Trust pillars ────────────────────────────────────────────────── */}
      <div>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">
          Основи платформи
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
          Три принципи, які не змінюються
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-brand-100 bg-brand-50/20 p-5 shadow-card">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                <Icon className="h-5 w-5" />
              </div>
              <p className="mt-3 font-semibold text-ink">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── CAN / CANNOT ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">
          Правила
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
          Що роботодавець може і що не може
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card className="space-y-4 border-l-[3px] border-l-brand-500 p-6">
            <h3 className="font-display text-lg font-bold text-brand-700">Роботодавець може</h3>
            <ul className="space-y-3">
              {CAN.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-ink-soft">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
          <Card className="space-y-4 border-l-[3px] border-l-red-400 p-6">
            <h3 className="font-display text-lg font-bold text-red-700">Роботодавець не може</h3>
            <ul className="space-y-3">
              {CANNOT.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm text-ink-soft">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-50/70 to-white p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-ink">
              Знайшли неточність у даних?
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              Звʼяжіться з платформою, щоб підтвердити профіль або уточнити інформацію.
            </p>
          </div>
        </div>
        <div className="mt-4 shrink-0 sm:mt-0">
          <Button href="/contact" variant="primary" size="md">
            Звʼязатися з нами
          </Button>
        </div>
      </div>
    </div>
  );
}
