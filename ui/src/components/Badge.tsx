/**
 * A status, as a word on its own tint.
 *
 * State is never carried by hue alone, so the word is not optional and there
 * is no icon-only form of this component. That rule is also what frees the
 * tint from the 3:1 floor, and it is checked in `design/rules.md`.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/events";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-text-secondary border-border-default",
  settled: "bg-settled-bg text-settled-text border-settled-border",
  expired: "bg-expired-bg text-expired-text border-expired-border",
  aborted: "bg-aborted-bg text-aborted-text border-aborted-border",
  open: "bg-open-bg text-open-text border-open-border",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5",
        "type-caption font-medium whitespace-nowrap",
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/**
 * The indicator on a run that has not closed.
 *
 * This is the only thing in the product that loops, and it stops when the run
 * closes, because a pulse that never stops is decoration.
 */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-1.5", className)} aria-hidden>
      <span className="live-halo absolute inset-0 rounded-full bg-open-solid" />
      <span className="relative inline-flex size-1.5 rounded-full bg-open-solid" />
    </span>
  );
}
