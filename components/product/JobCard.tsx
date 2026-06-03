import Link from "next/link";
import { MapPin, Wallet, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RiskBadge } from "@/components/product/Badges";
import type { Job } from "@/lib/types";

export function JobCard({ job }: { job: Job }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-ink">{job.title}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {job.city}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-ink">
              <Wallet className="h-3.5 w-3.5" /> {job.salary}
            </span>
          </div>
        </div>
        <RiskBadge level={job.riskLevel} />
      </div>

      <p className="text-sm text-ink-soft">{job.shortDescription}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">Джерело: {job.source}</Badge>
        {job.bookingClaimed ? (
          <Badge tone="brand">бронювання заявлено</Badge>
        ) : (
          <Badge tone="muted">бронювання не заявлено</Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-ink/[0.06] pt-3">
        <Link
          href="/check-job"
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
        >
          Перевірити вакансію <ChevronRight className="h-4 w-4" />
        </Link>
        <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
          Приклад вакансії
        </span>
      </div>
    </Card>
  );
}

export function InterviewQuestions({ questions }: { questions: string[] }) {
  return (
    <ol className="space-y-2.5">
      {questions.map((q, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
            {i + 1}
          </span>
          <span className="pt-0.5 text-sm text-ink-soft">{q}</span>
        </li>
      ))}
    </ol>
  );
}
