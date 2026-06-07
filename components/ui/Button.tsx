import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "inverse";
type Size = "sm" | "md" | "lg" | "xl";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.01em] rounded-xl transition-all focus-ring disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-700 text-white border-t border-white/10 hover:bg-brand-800 active:bg-brand-900 shadow hover:shadow-md",
  secondary: "bg-ink/90 text-white hover:bg-ink shadow-sm hover:shadow",
  ghost: "text-ink-soft hover:bg-brand-50 hover:text-brand-700",
  outline:
    "border border-brand-300 bg-white text-brand-700 hover:border-brand-400 hover:bg-brand-50 hover:shadow-sm",
  inverse:
    "bg-white text-brand-800 hover:bg-brand-50 shadow-sm hover:shadow",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3.5 py-2",
  md: "text-sm px-5 py-2.5",
  lg: "text-base px-6 py-3.5",
  xl: "text-base px-8 py-4",
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
}

type ButtonAsButton = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & { href: string } & Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    keyof CommonProps | "href"
  >;

export function Button(props: ButtonAsButton | ButtonAsLink) {
  const { variant = "primary", size = "md", className, children, ...rest } = props;
  const classes = cn(base, variants[variant], sizes[size], className);

  if ("href" in props && props.href) {
    const { href, ...anchorRest } = rest as { href: string } & Record<string, unknown>;
    return (
      <Link href={href} className={classes} {...anchorRest}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
