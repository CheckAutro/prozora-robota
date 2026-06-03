import { ScoreBar } from "@/components/ui/ScoreCircle";
import type { Company } from "@/lib/types";
import { getRiskColor } from "@/lib/scoring";

export function CompanyScores({ company }: { company: Company }) {
  const delay =
    company.paymentDelayRisk === "high"
      ? { v: 80, label: "високий" }
      : company.paymentDelayRisk === "medium"
      ? { v: 50, label: "середній" }
      : { v: 15, label: "низький" };

  // For payment-delay risk, higher number = worse, so invert the colour scale
  // by showing it as a value where lower is better visually via the bar.
  const delayColor = getRiskColor(company.paymentDelayRisk);

  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      <ScoreBar
        score={company.salaryMatchPercent}
        label="Реальність зарплати"
        hint="Наскільки фактичний дохід збігається з вакансією"
      />
      <ScoreBar
        score={company.officialEmploymentPercent}
        label="Офіційне оформлення"
        hint="Частка відгуків з офіційним оформленням"
      />
      <ScoreBar
        score={company.bookingConfirmedPercent}
        label="Бронювання (підтверджено)"
        hint="Скільки відгуків підтверджують реальне оформлення броні"
      />
      <ScoreBar
        score={company.internshipPaidPercent}
        label="Оплата стажування"
        hint="Частка відгуків з оплачуваним стажуванням"
      />
      <div className="space-y-1.5 sm:col-span-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-ink-soft">Ризик затримок виплат</span>
          <span className={`text-sm font-bold ${delayColor.text}`}>{delay.label}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-ink/[0.06]">
          <div
            className={`h-full rounded-full ${delayColor.dot}`}
            style={{ width: `${delay.v}%`, transition: "width 0.8s ease" }}
          />
        </div>
        <p className="text-xs text-ink-muted">Чим коротша смуга, тим менший ризик затримок</p>
      </div>
    </div>
  );
}
