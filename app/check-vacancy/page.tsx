import { Suspense } from "react";
import type { Metadata } from "next";
import { VacancyCheckClient } from "@/components/product/VacancyCheckClient";

export const metadata: Metadata = {
  title: "Перевірити вакансію або роботодавця — Прозора робота",
  description:
    "Введіть назву компанії або текст вакансії — дізнайтесь, чи є відгуки, рейтинг та ризики перед співбесідою.",
};

export default function CheckVacancyPage() {
  return (
    <Suspense
      fallback={<div className="container-page py-10 text-ink-muted">Завантаження…</div>}
    >
      <VacancyCheckClient />
    </Suspense>
  );
}
