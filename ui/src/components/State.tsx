/**
 * A state, as a dot and a word.
 *
 * Never the dot alone. Around 4.5% of men cannot separate red from green, and
 * an operator reading an outcome needs the outcome rather than a hint. Pairing
 * every colour with its own word is also what frees the dot from a contrast
 * floor, since it reinforces a label rather than carrying the meaning.
 */
import { cn } from "@/lib/cn";
import type { Outcome } from "@/lib/events";

export type Tone = "neutral" | "live" | "ok" | "warn" | "bad";

const TEXT: Record<Tone, string> = {
  neutral: "text-text-2",
  live: "text-live",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-edge-strong",
  live: "bg-live-solid",
  ok: "bg-ok-solid",
  warn: "bg-warn-solid",
  bad: "bg-bad-solid",
};

export function State({
  tone,
  children,
  pulse = false,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap type-caption",
        TEXT[tone],
        className
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", DOT[tone], pulse && "pulse")}
      />
      {children}
    </span>
  );
}

const OUTCOME: Record<Outcome, { tone: Tone; label: string }> = {
  settled: { tone: "ok", label: "Settled" },
  wall_clock_expired: { tone: "warn", label: "Wall clock expired" },
  aborted: { tone: "bad", label: "Aborted" },
};

export function RunState({
  outcome,
  className,
}: {
  outcome: Outcome | null;
  className?: string;
}) {
  if (outcome === null) {
    return (
      <State tone="live" pulse className={className}>
        Open
      </State>
    );
  }
  const { tone, label } = OUTCOME[outcome];
  return (
    <State tone={tone} className={className}>
      {label}
    </State>
  );
}
