"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Link2, FileText, Sparkles, RefreshCw } from "lucide-react";

import { Card, SectionTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { JobRiskAnalysis } from "@/components/product/JobRiskAnalysis";
import { analyzeJobText } from "@/lib/analyze-job";
import type { JobAnalysis } from "@/lib/types";

export function CheckJobClient() {
  const searchParams = useSearchParams();
  const initialUrl = searchParams.get("url") ?? "";

  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);

  function handleAnalyze() {
    setAnalysis(analyzeJobText(text, url || undefined));
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleReset() {
    setUrl("");
    setText("");
    setAnalysis(null);
  }

  return (
    <div className="container-page max-w-3xl space-y-8 py-8 sm:py-10">
      <SectionTitle
        eyebrow="Перевірка вакансії"
        title="Проаналізуйте вакансію до відгуку"
        description="Вставте посилання або текст вакансії. Аналіз орієнтовний і не замінює прямих питань роботодавцю."
      />

      {!analysis && (
        <Card className="space-y-5 p-6">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-ink-soft">
              <Link2 className="h-4 w-4" /> Посилання на вакансію
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Вставте посилання на вакансію (work.ua, robota.ua…)"
              className="focus-ring w-full rounded-xl border border-ink/[0.1] bg-white px-4 py-3 text-sm text-ink placeholder:text-ink-muted"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-ink-soft">
              <FileText className="h-4 w-4" /> Або вставте текст вакансії
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Скопіюйте сюди опис вакансії: обов'язки, зарплата, оформлення, бронювання, стажування…"
              className="focus-ring w-full resize-y rounded-xl border border-ink/[0.1] bg-white px-4 py-3 text-sm text-ink placeholder:text-ink-muted"
            />
          </div>

          <Button onClick={handleAnalyze} size="lg" className="w-full sm:w-auto">
            <Sparkles className="h-4 w-4" /> Проаналізувати вакансію
          </Button>
        </Card>
      )}

      {analysis && (
        <div className="space-y-6">
          <JobRiskAnalysis analysis={analysis} />

          <div className="flex flex-wrap gap-3">
            <Button href="/add-review" variant="primary">
              Додати відгук про цю компанію
            </Button>
            <Button onClick={handleReset} variant="secondary">
              <RefreshCw className="h-4 w-4" /> Перевірити іншого роботодавця
            </Button>
          </div>

          <p className="text-center text-xs text-ink-muted">
            Не знаєте, з чого почати?{" "}
            <Link href="/companies" className="font-medium text-brand-700 underline">
              Перегляньте каталог компаній
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
