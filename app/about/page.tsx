import type { Metadata } from "next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ShieldCheck, Eye, Scale, Users, FileSearch, Search, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Про проєкт — Прозора робота",
  description:
    "Що таке «Прозора робота», навіщо сервіс, як працюють анонімні відгуки та модерація.",
};

const STEPS = [
  {
    number: "01",
    icon: Search,
    title: "Знайди компанію",
    text: "Введіть назву компанії або вакансії — знайдіть відгуки, відкриті джерела та сигнали.",
  },
  {
    number: "02",
    icon: Eye,
    title: "Перечитай досвід",
    text: "Анонімні відгуки відфільтровані, структуровані та доповнені відкритими даними.",
  },
  {
    number: "03",
    icon: CheckCircle2,
    title: "Прийми рішення",
    text: "Підтвердіть ключові умови письмово перед підписанням — зарплату, оформлення, графік.",
  },
];

const PRINCIPLES = [
  {
    icon: FileSearch,
    title: "Що це таке",
    text: "«Прозора робота» — сервіс, який допомагає кандидатам в Україні зрозуміти реальні умови роботи ще до співбесіди: зарплату, оформлення, бронювання та стажування.",
  },
  {
    icon: Users,
    title: "Навіщо це потрібно",
    text: "Вакансія часто показує лише частину правди. Ми збираємо досвід людей, які вже працювали або були на співбесіді, щоб рішення приймалося усвідомлено.",
  },
  {
    icon: ShieldCheck,
    title: "Анонімно й під модерацією",
    text: "Анонімність захищає авторів від тиску. Модерація прибирає персональні дані, образи та неперевірені звинувачення до публікації.",
  },
  {
    icon: Eye,
    title: "Як працюють відгуки",
    text: "Користувачі залишають структуровані анонімні відгуки. На їх основі формуються індекси довіри, бронювання, реальності зарплати та оформлення.",
  },
];

export default function AboutPage() {
  return (
    <div className="container-page max-w-3xl space-y-12 py-8 sm:py-10">

      {/* ── Mission hero ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-50/60 to-white p-7 sm:p-10">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">
          Про проєкт
        </p>
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Прозора робота
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
          Реальний досвід кандидатів і відкриті дані про роботодавців в одному місці.
          Анонімно, з модерацією, без маніпуляцій з рейтингом.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href="/companies" variant="primary" size="md">
            Переглянути компанії
          </Button>
          <Button href="/check-vacancy" variant="outline" size="md">
            Перевірити вакансію
          </Button>
        </div>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">
          Як це працює
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
          Три кроки до усвідомленого рішення
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ number, icon: Icon, title, text }) => (
            <div key={number} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="font-display text-3xl font-extrabold text-brand-500">
                  {number}
                </span>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                  <Icon className="h-4.5 w-4.5" />
                </div>
              </div>
              <div>
                <p className="font-semibold text-ink">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Principles grid ──────────────────────────────────────────────── */}
      <div>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">
          Принципи
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink">
          На чому побудований сервіс
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(({ icon: Icon, title, text }) => (
            <Card key={title} className="flex gap-4 border-brand-100 bg-brand-50/30 p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                <Icon className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-ink">{title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{text}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Legal note ───────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl border border-ink/[0.07] bg-ink/[0.025] px-4 py-3.5">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <p className="text-sm leading-relaxed text-ink-soft">
          <span className="font-semibold text-ink">Це не юридичний висновок.</span>{" "}
          Оцінки сервісу — агрегований досвід користувачів, а не офіційна перевірка роботодавця.
          Остаточні умови завжди уточнюйте напряму в компанії.
        </p>
      </div>
    </div>
  );
}
