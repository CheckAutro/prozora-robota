import type { Metadata } from "next";
import { Mail, MessageSquarePlus, Building2, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Контакти | Прозора робота",
  description:
    "Контакти сервісу Прозора робота для кандидатів, роботодавців та питань щодо модерації.",
};

const CONTACT_EMAIL = "contact@prozora-robota.ua";

export default function ContactPage() {
  return (
    <div className="container-page max-w-3xl space-y-8 py-10">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
          Звʼязок із нами
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">Контакти</h1>
        <p className="mt-3 text-ink-soft">
          Маєте питання або хочете повідомити про порушення? Ми відповідаємо на листи
          протягом кількох робочих днів.
        </p>
      </div>

      {/* ── For candidates ─────────────────────────────────────────────── */}
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2.5 font-semibold text-ink">
          <MessageSquarePlus className="h-5 w-5 text-brand-600" />
          Для кандидатів
        </div>
        <p className="text-sm text-ink-soft">
          Якщо ви хочете залишити анонімний відгук про роботодавця або маєте запитання
          щодо форми відгуку — скористайтесь кнопкою нижче або напишіть нам.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button href="/add-review" variant="primary" size="sm">
            <MessageSquarePlus className="h-4 w-4" /> Додати відгук
          </Button>
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Питання кандидата`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 px-4 py-2 text-sm text-ink-soft hover:border-brand-300 hover:text-brand-700"
          >
            <Mail className="h-4 w-4" /> {CONTACT_EMAIL}
          </a>
        </div>
      </Card>

      {/* ── For employers ──────────────────────────────────────────────── */}
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2.5 font-semibold text-ink">
          <Building2 className="h-5 w-5 text-brand-600" />
          Для роботодавців
        </div>
        <p className="text-sm text-ink-soft">
          Якщо ви представляєте компанію і хочете дізнатись про умови розміщення
          інформації, виправлення неточностей або звернутися щодо конкретного відгуку —
          перегляньте розділ для роботодавців або напишіть нам.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button href="/for-employers" variant="secondary" size="sm">
            <Building2 className="h-4 w-4" /> Для роботодавців
          </Button>
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Звернення роботодавця`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 px-4 py-2 text-sm text-ink-soft hover:border-brand-300 hover:text-brand-700"
          >
            <Mail className="h-4 w-4" /> {CONTACT_EMAIL}
          </a>
        </div>
      </Card>

      {/* ── Moderation questions ────────────────────────────────────────── */}
      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2.5 font-semibold text-ink">
          <ShieldCheck className="h-5 w-5 text-brand-600" />
          Питання щодо модерації
        </div>
        <p className="text-sm text-ink-soft">
          Якщо ваш відгук не опублікований, відхилений або ви вважаєте, що відгук про
          вашу компанію порушує правила — напишіть нам із темою «Модерація».
        </p>
        <ul className="space-y-2 text-sm text-ink-soft">
          <li className="flex items-start gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
            Відгуки проходять ручну модерацію перед публікацією.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
            Персональні дані (телефони, email, імена) видаляються автоматично та вручну.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
            Якщо відгук містить образи або навмисно неправдиву інформацію — він не буде
            опублікований.
          </li>
        </ul>
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=Питання щодо модерації`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 px-4 py-2 text-sm text-ink-soft hover:border-brand-300 hover:text-brand-700"
        >
          <Mail className="h-4 w-4" /> {CONTACT_EMAIL}
        </a>
      </Card>

      <p className="text-xs text-ink-muted">
        Ми намагаємось відповідати протягом 1–3 робочих днів.
      </p>
    </div>
  );
}
