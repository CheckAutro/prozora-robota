import Link from "next/link";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all focus-ring disabled:opacity-50 disabled:cursor-not-allowed select-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm hover:shadow",
  secondary: "bg-ink text-white hover:bg-ink/90",
  ghost: "text-ink-soft hover:bg-brand-50 hover:text-brand-700",
  outline:
    "border border-ink/15 bg-white text-ink hover:border-brand-300 hover:bg-brand-50/50",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3.5 py-2",
  md: "text-sm px-5 py-2.5",
  lg: "text-base px-6 py-3.5",
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
