"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

export function SearchBar({
  size = "lg",
  placeholder = "Введіть назву компанії або вставте посилання на вакансію",
}: {
  size?: "md" | "lg";
  placeholder?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit() {
    const q = value.trim();
    if (!q) {
      router.push("/check-vacancy");
      return;
    }
    router.push(`/check-vacancy?q=${encodeURIComponent(q)}`);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center rounded-2xl border border-ink/[0.12] bg-white p-2 shadow-card transition-all duration-200 focus-within:border-brand-300 focus-within:shadow-glow-brand",
        size === "lg" ? "sm:p-2.5" : ""
      )}
    >
      <div className="flex flex-1 items-center gap-2 px-2">
        <Search className="h-5 w-5 shrink-0 text-ink-muted" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={placeholder}
          className={cn(
            "w-full bg-transparent text-ink placeholder:text-ink-muted/60 focus:outline-none",
            size === "lg" ? "py-2.5 text-base" : "py-2 text-sm"
          )}
          aria-label="Пошук роботодавця або вакансії"
        />
      </div>
      <button
        onClick={handleSubmit}
        className={cn(
          "rounded-xl bg-brand-600 font-semibold text-white transition-all hover:bg-brand-700 active:bg-brand-800 active:scale-[0.98] focus-ring",
          size === "lg" ? "px-7 py-3 text-base" : "px-5 py-2.5 text-sm",
          "w-full sm:w-auto"
        )}
      >
        Перевірити
      </button>
    </div>
  );
}
