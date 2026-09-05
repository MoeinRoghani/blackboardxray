/**
 * Stage 11. One family, by emphasis, and the state matrix every other control
 * copies.
 *
 * The hit target is at least 44px even where the visible control is shorter:
 * a padded pseudo-element carries the extra, so a dense row keeps its rhythm
 * and a thumb still lands. `:focus-visible` is never removed.
 */
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Emphasis = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const EMPHASIS: Record<Emphasis, string> = {
  primary: cn(
    "bg-brand-solid text-brand-on-solid",
    "hover:bg-brand-solid-hover",
    "active:translate-y-px"
  ),
  secondary: cn(
    "bg-surface-raised text-text-primary border border-border-default",
    "hover:bg-surface-hover hover:border-border-strong",
    "active:bg-surface-active active:translate-y-px"
  ),
  ghost: cn(
    "bg-transparent text-text-secondary",
    "hover:bg-surface-hover hover:text-text-primary",
    "active:bg-surface-active"
  ),
};

const SIZE: Record<Size, string> = {
  sm: "h-6 px-2 gap-1 type-caption",
  md: "h-8 px-3 gap-2 type-small",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  emphasis?: Emphasis;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
  children?: ReactNode;
}

export function Button({
  emphasis = "secondary",
  size = "md",
  loading = false,
  asChild = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(
        "relative inline-flex items-center justify-center rounded-sm",
        "font-medium whitespace-nowrap select-none",
        "transition-colors duration-fast ease-standard",
        // The invisible half of the hit target.
        "before:absolute before:left-0 before:right-0 before:top-1/2",
        "before:h-11 before:-translate-y-1/2 before:content-['']",
        "disabled:pointer-events-none disabled:opacity-50",
        EMPHASIS[emphasis],
        SIZE[size],
        className
      )}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {/* Slot forwards its props onto exactly one child, so a spinner beside
          the child would be a second one and it refuses. A button rendered as
          a link is navigation and has no loading state to show. */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : null}
          {children}
        </>
      )}
    </Component>
  );
}
