/**
 * The mark beside a state word.
 *
 * State is never the dot alone: around one man in twenty cannot separate red
 * from green, so every one of these appears next to the word it reinforces.
 * That pairing is also what frees the dot from a contrast floor.
 *
 * An open run pulses. It is the only thing in the product that says live
 * without saying the word, and it stops the moment the run closes.
 */
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/events";

const FILL: Record<Tone, string> = {
  neutral: "bg-edge-strong",
  live: "bg-live-solid",
  ok: "bg-ok-solid",
  warn: "bg-warn-solid",
  bad: "bg-bad-solid",
};

export const TEXT: Record<Tone, string> = {
  neutral: "text-text",
  live: "text-live",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
};

export function Dot({ tone, big }: { tone: Tone; big?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 rounded-full",
        big ? "size-2" : "size-1.5",
        FILL[tone],
        tone === "live" && "pulse"
      )}
    />
  );
}
