/**
 * One family by emphasis. There is no filled accent button, because a tool
 * that only reads has no primary action to fill.
 *
 * The hit target is 44px even where the control is shorter: a padded
 * pseudo-element carries the difference, so a dense header keeps its rhythm
 * and a thumb still lands.
 */
import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Emphasis = "solid" | "quiet" | "bare";
type Size = "sm" | "md";

const EMPHASIS: Record<Emphasis, string> = {
  solid: "bg-surface-2 text-text border border-edge hover:bg-hover hover:border-edge-strong active:bg-active",
  quiet: "bg-transparent text-text-2 border border-transparent hover:bg-hover hover:text-text",
  bare: "bg-transparent text-live border border-transparent hover:opacity-80",
};

const SIZE: Record<Size, string> = {
  sm: "h-6 px-2 gap-1 type-caption",
  md: "h-8 px-3 gap-1.5 type-small",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  emphasis?: Emphasis;
  size?: Size;
  asChild?: boolean;
  children?: ReactNode;
}

export function Button({
  emphasis = "quiet",
  size = "md",
  asChild = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(
        "move-state relative inline-flex select-none items-center justify-center",
        "whitespace-nowrap rounded-sm font-medium",
        "before:absolute before:inset-x-0 before:top-1/2 before:h-11",
        "before:-translate-y-1/2 before:content-['']",
        "disabled:pointer-events-none disabled:opacity-40",
        EMPHASIS[emphasis],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
