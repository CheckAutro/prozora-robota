import { Suspense } from "react";
import type { Metadata } from "next";
import { CheckJobClient } from "@/components/product/CheckJobClient";

export const metadata: Metadata = {
  title: "Перевірити вакансію — Прозора робота",
  description:
    "Орієнтовний аналіз вакансії: ризики бронювання, зарплати, оформлення та стажування, плюс питання для співбесіди.",
};

export default function CheckJobPage() {
  return (
    <Suspense
      fallback={<div className="container-page py-10 text-ink-muted">Завантаження…</div>}
    >
      <CheckJobClient />
    </Suspense>
  );
}
