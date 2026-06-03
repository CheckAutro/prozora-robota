import { ShieldCheck, MapPin, Calendar, Star } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { Review, ReviewType } from "@/lib/types";

const TYPE_LABEL: Record<ReviewType, string> = {
  employee: "Анонімний працівник",
  interview: "Анонімний кандидат",
  internship: "Анонімний стажер",
  applicant: "Анонімний кандидат",
};

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} з 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-3.5 w-3.5",
            n <= value ? "fill-amber-400 text-amber-400" : "text-ink/15"
          )}
        />
      ))}
    </span>
  );
}

export function ReviewCard({ review }: { review: Review }) {
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">{TYPE_LABEL[review.type]}</span>
          {review.verified ? (
            <Badge tone="brand">
              <ShieldCheck className="h-3 w-3" /> Підтверджено платформою
            </Badge>
          ) : (
            <Badge tone="muted">
              Анонімний відгук
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {review.city}
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" /> {review.year}
          </span>
        </div>
      </div>

      <p className="text-xs text-ink-muted">{review.roleCategory}</p>

      <p className="text-sm leading-relaxed text-ink-soft">{review.text}</p>

      {review.badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {review.badges.map((b, i) => (
            <Badge key={i} tone="neutral">
              {b}
            </Badge>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-ink/[0.06] pt-3 sm:grid-cols-3">
        <RatingRow label="Зарплата" value={review.ratings.salary} />
        <RatingRow label="Графік" value={review.ratings.schedule} />
        <RatingRow label="Керівництво" value={review.ratings.management} />
        <RatingRow label="Умови" value={review.ratings.conditions} />
        <RatingRow label="Чесність вакансії" value={review.ratings.honesty} />
      </div>
    </Card>
  );
}

function RatingRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-ink-muted">{label}</span>
      <Stars value={value} />
    </div>
  );
}
