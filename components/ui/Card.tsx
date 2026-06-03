import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "article" | "section";
}) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-ink/[0.06] bg-white shadow-card",
        className
      )}
    >
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
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-xl sm:text-2xl font-bold text-ink leading-tight">
        {title}
      </h2>
      {description && (
        <p className="text-ink-soft text-sm sm:text-base max-w-2xl">{description}</p>
      )}
    </div>
  );
}
