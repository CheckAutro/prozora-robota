import {
  Wallet,
  FileCheck,
  ShieldCheck,
  GraduationCap,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { RiskBadge } from "@/components/product/Badges";
import { InterviewQuestions } from "@/components/product/JobCard";
import { ExplanationBlock } from "@/components/product/MetricCard";
import type { JobAnalysis, JobAnalysisSection } from "@/lib/types";

function Section({
  icon,
  title,
  data,
}: {
  icon: React.ReactNode;
  title: string;
  data: JobAnalysisSection;
}) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="text-brand-600">{icon}</span>
        <h4 className="font-semibold text-ink">{title}</h4>
        <span className="ml-auto rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-xs font-medium text-ink-soft">
          {data.status}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{data.detail}</p>
      <p className="mt-2 flex gap-2 text-xs text-ink-muted">
        <span className="font-semibold text-ink-soft">Уточнити:</span>
        {data.toClarify}
      </p>
    </div>
  );
}

export function JobRiskAnalysis({ analysis }: { analysis: JobAnalysis }) {
  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-lg font-bold text-ink">Загальний висновок</h3>
          <RiskBadge level={analysis.riskLevel} />
        </div>
        <p className="leading-relaxed text-ink-soft">{analysis.summary}</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Section icon={<ShieldCheck className="h-5 w-5" />} title="Бронювання" data={analysis.booking} />
        <Section icon={<Wallet className="h-5 w-5" />} title="Зарплата" data={analysis.salary} />
        <Section icon={<FileCheck className="h-5 w-5" />} title="Оформлення" data={analysis.employment} />
        <Section
          icon={<GraduationCap className="h-5 w-5" />}
          title="Стажування"
          data={analysis.internship}
        />
      </div>

      <Card className="space-y-3 p-6">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h3 className="font-display text-lg font-bold text-ink">Червоні прапорці</h3>
        </div>
        <ul className="space-y-2">
          {analysis.redFlags.map((flag, i) => (
            <li key={i} className="flex gap-2 text-sm text-ink-soft">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              {flag}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-brand-600" />
          <h3 className="font-display text-lg font-bold text-ink">Що запитати на співбесіді</h3>
        </div>
        <InterviewQuestions questions={analysis.interviewQuestions} />
      </Card>

      <ExplanationBlock>
        Це автоматичний аналіз тексту вакансії, а не юридичний висновок. Він підсвічує, що варто
        уточнити, але не підтверджує і не спростовує реальних умов роботодавця.
      </ExplanationBlock>
    </div>
  );
}
