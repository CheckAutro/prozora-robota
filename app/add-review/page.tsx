import { Suspense } from "react";
import type { Metadata } from "next";
import { AddReviewClient } from "@/components/product/AddReviewClient";

export const metadata: Metadata = {
  title: "Додати анонімний відгук — Прозора робота",
  description:
    "Залиште анонімний відгук про роботодавця: зарплата, оформлення, бронювання та стажування.",
};

export default function AddReviewPage() {
  return (
    <Suspense
      fallback={<div className="container-page py-10 text-ink-muted">Завантаження…</div>}
    >
      <AddReviewClient />
    </Suspense>
  );
}
