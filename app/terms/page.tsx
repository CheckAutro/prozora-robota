import type { Metadata } from "next";
import { ShieldCheck, FileText, AlertTriangle, Building2, Ban, Info } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Умови користування | Прозора робота",
  description:
    "Правила використання сервісу Прозора робота, модерації відгуків та обробки контенту.",
};

const SECTIONS = [
  {
    icon: FileText,
    title: "Що таке Прозора робота",
    items: [
      "Прозора робота — сервіс анонімних відгуків про роботодавців в Україні.",
      "Сервіс публікує відгуки після модерації. Відгуки відображають суб'єктивний досвід авторів і не є офіційною оцінкою компаній.",
      "Інформація на сайті не є юридичним, фінансовим або кадровим висновком.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "Правила розміщення відгуків",
    items: [
      "Користувач не має права вказувати у відгуку персональні дані інших людей: імена, телефони, email, Telegram, Instagram або інші ідентифікатори.",
      "Не можна публікувати образи, погрози, дискримінаційний або ненависницький контент.",
      "Не можна навмисно публікувати неправдиву інформацію або вводити в оману інших користувачів.",
      "Відгук має описувати реальний особистий досвід — роботу, співбесіду, стажування або звернення до компанії.",
    ],
  },
  {
    icon: AlertTriangle,
    title: "Права платформи щодо контенту",
    items: [
      "Платформа може відхилити, приховати або видалити відгук, якщо він порушує правила або містить персональні дані.",
      "Платформа залишає за собою право редагувати або видаляти контент без попереднього повідомлення у разі порушення правил.",
      "Платформа не продає видалення негативних відгуків і не гарантує зміну рейтингу компанії.",
    ],
  },
  {
    icon: Building2,
    title: "Права роботодавців",
    items: [
      "Роботодавець може звернутися до адміністрації сервісу щодо неточностей або порушення правил у конкретному відгуку.",
      "Звернення розглядається вручну. Відгук видаляється або коригується лише у разі підтвердженого порушення правил.",
      "Роботодавець не має права вимагати видалення відгуку лише на підставі того, що він містить критику або негативну оцінку.",
    ],
  },
  {
    icon: Info,
    title: "Зовнішні сигнали",
    items: [
      "Платформа може зберігати зовнішні сигнали — короткі нотатки адміна на основі відкритих джерел.",
      "Зовнішні сигнали не є відгуками користувачів платформи і відображаються окремо від відгуків.",
      "Зовнішні сигнали — це нейтральні узагальнення, не копії чужих відгуків.",
    ],
  },
  {
    icon: Ban,
    title: "Відповідальність",
    items: [
      "Автори відгуків несуть відповідальність за зміст своїх публікацій відповідно до законодавства України.",
      "Платформа не несе відповідальності за точність, повноту або актуальність інформації у відгуках.",
      "Використовуючи сервіс, ви погоджуєтесь з цими умовами.",
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="container-page max-w-3xl space-y-8 py-10">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
          Юридична інформація
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">
          Умови користування
        </h1>
        <p className="mt-3 text-ink-soft">
          Правила використання платформи Прозора робота та розміщення відгуків.
        </p>
      </div>

      <div className="space-y-4">
        {SECTIONS.map(({ icon: Icon, title, items }) => (
          <Card key={title} className="p-6">
            <div className="flex items-center gap-2.5 font-semibold text-ink">
              <Icon className="h-5 w-5 text-brand-600" />
              {title}
            </div>
            <ul className="mt-4 space-y-2.5">
              {items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-ink-soft">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <p className="text-xs text-ink-muted">
        Умови оновлено: червень 2026. З питань щодо контенту:{" "}
        <a
          href="mailto:contact@prozora-robota.ua"
          className="text-brand-700 hover:underline"
        >
          contact@prozora-robota.ua
        </a>
      </p>

      <div className="flex flex-wrap gap-3">
        <Button href="/privacy" variant="secondary" size="sm">
          Конфіденційність
        </Button>
        <Button href="/contact" variant="secondary" size="sm">
          Контакти
        </Button>
      </div>
    </div>
  );
}
