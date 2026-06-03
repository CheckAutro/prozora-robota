import type { Metadata } from "next";
import { SectionTitle, Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Check, X } from "lucide-react";

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

export default function ForEmployersPage() {
  return (
    <div className="container-page max-w-3xl space-y-8 py-8 sm:py-10">
      <SectionTitle
        eyebrow="Для роботодавців"
        title="Прозорі правила для компаній"
        description="Ми за чесний діалог: компанія може реагувати на відгуки, але не може купувати рейтинг чи розкривати авторів."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-3 p-6">
          <h3 className="font-display text-lg font-bold text-brand-700">Роботодавець може</h3>
          <ul className="space-y-2.5">
            {CAN.map((item) => (
              <li key={item} className="flex gap-2.5 text-sm text-ink-soft">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                {item}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-3 p-6">
          <h3 className="font-display text-lg font-bold text-red-700">Роботодавець не може</h3>
          <ul className="space-y-2.5">
            {CANNOT.map((item) => (
              <li key={item} className="flex gap-2.5 text-sm text-ink-soft">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="flex flex-col items-start gap-4 bg-brand-700 p-6 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-lg font-bold">Знайшли неточність у даних?</h3>
          <p className="mt-1 text-sm text-white/80">
            Звʼяжіться з платформою, щоб підтвердити профіль або уточнити інформацію.
          </p>
        </div>
        <Button href="/contact" variant="secondary" size="lg">
          Звʼязатися з нами
        </Button>
      </Card>
    </div>
  );
}
