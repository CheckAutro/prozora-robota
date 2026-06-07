import { cn } from "@/lib/cn";

type CardVariant = "default" | "elevated" | "tinted";

const CARD_VARIANT: Record<CardVariant, string> = {
  default: "rounded-2xl border border-ink/[0.06] bg-white shadow-card",
  elevated: "rounded-2xl border border-ink/[0.04] bg-white shadow-card-elevated ring-1 ring-ink/[0.03]",
  tinted: "rounded-2xl border border-brand-100 bg-brand-50/60",
};

export function Card({
  className,
  children,
  as: Tag = "div",
  variant = "default",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "article" | "section";
  variant?: CardVariant;
}) {
  return (
    <Tag className={cn(CARD_VARIANT[variant], className)}>
      {children}
    </Tag>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {eyebrow && (
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-xl sm:text-2xl font-bold text-ink leading-tight text-balance">
        {title}
      </h2>
      {description && (
        <p className="text-ink-soft text-sm sm:text-base max-w-2xl text-balance">{description}</p>
      )}
    </div>
  );
}
