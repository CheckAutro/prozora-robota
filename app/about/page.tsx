import type { Metadata } from "next";
import { SectionTitle, Card } from "@/components/ui/Card";
import { ShieldCheck, Eye, Scale, Users, FileSearch } from "lucide-react";

export const metadata: Metadata = {
  title: "Про проєкт — Прозора робота",
  description:
    "Що таке «Прозора робота», навіщо сервіс, як працюють анонімні відгуки та модерація.",
};

const POINTS = [
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
    icon: Eye,
    title: "Як працюють відгуки",
    text: "Користувачі залишають структуровані анонімні відгуки. На їх основі формуються індекси довіри, бронювання, реальності зарплати та оформлення.",
  },
  {
    icon: ShieldCheck,
    title: "Чому анонімно й під модерацією",
    text: "Анонімність захищає авторів від тиску. Модерація потрібна, щоб прибрати персональні дані, образи та неперевірені звинувачення до публікації.",
  },
  {
    icon: Scale,
    title: "Це не юридичний висновок",
    text: "Оцінки сервісу — це агрегований досвід користувачів, а не офіційна перевірка роботодавця. Остаточні умови завжди уточнюйте напряму в компанії.",
  },
];

export default function AboutPage() {
  return (
    <div className="container-page max-w-3xl space-y-8 py-8 sm:py-10">
      <SectionTitle
        eyebrow="Про проєкт"
        title="Прозора робота"
        description="Перевір роботодавця до відгуку — спокійно, анонімно та без зайвих ризиків."
      />
      <div className="space-y-4">
        {POINTS.map(({ icon: Icon, title, text }) => (
          <Card key={title} className="flex gap-4 p-5">
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
  );
}
