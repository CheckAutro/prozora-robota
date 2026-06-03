import { ExternalLink, Star, UsersRound, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { ExternalRating } from "@/lib/types";

function formatDate(value: string | null): string {
  if (!value) return "Дата оновлення не вказана";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата оновлення не вказана";
  return date.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value);
}

export function ExternalRatingsSection({
  ratings,
}: {
  ratings: ExternalRating[];
}) {
  if (ratings.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">
          Оцінки з відкритих джерел
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Це довідкові оцінки з інших сервісів. Вони не є відгуками Прозора
          робота і не впливають на наш рейтинг.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {ratings.map((rating) => (
          <Card key={rating.id} className="space-y-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink">{rating.sourceName}</h3>
                <p className="text-xs text-ink-muted">{rating.companyName}</p>
              </div>
              {rating.sourceUrl && (
                <a
                  href={rating.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink/10 text-ink-muted hover:border-brand-300 hover:text-brand-700 focus-ring"
                  aria-label={`Відкрити джерело ${rating.sourceName}`}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>

            <div className="grid gap-2 text-sm text-ink-soft">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-amber-400" />
                  Оцінка
                </span>
                <span className="font-semibold text-ink">
                  {rating.ratingValue !== null
                    ? `${rating.ratingValue.toFixed(1)} / ${rating.ratingScale ?? 5}`
                    : "Не вказана"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <UsersRound className="h-4 w-4 text-brand-600" />
                  Кількість оцінок
                </span>
                <span className="font-semibold text-ink">
                  {formatNumber(rating.reviewsCount)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4 text-brand-600" />
                  Оновлено
                </span>
                <span className="text-right font-semibold text-ink">
                  {formatDate(rating.fetchedAt)}
                </span>
              </div>
            </div>

            {rating.note && (
              <p className="border-t border-ink/[0.06] pt-3 text-xs text-ink-muted">
                {rating.note}
              </p>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
