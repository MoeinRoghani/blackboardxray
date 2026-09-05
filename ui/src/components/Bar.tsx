/**
 * One labelled bar. The whole chart vocabulary this product needs.
 *
 * Specs are fixed: a thin mark, a 4px rounded data-end square at the baseline,
 * a recessive track, and no border drawn around the fill. The value is always
 * rendered beside the bar rather than only on hover, so nothing is gated: the
 * row is a table row that happens to carry a mark.
 */
import { cn } from "@/lib/cn";
import { count } from "@/lib/format";
import type { Tone } from "@/components/State";

const FILL: Record<Tone, string> = {
  neutral: "bg-edge-strong",
  live: "bg-live-solid",
  ok: "bg-ok-solid",
  warn: "bg-warn-solid",
  bad: "bg-bad-solid",
};

const INK: Record<Tone, string> = {
  neutral: "text-text",
  live: "text-live",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
};

export function Bar({
  label,
  value,
  of,
  tone = "neutral",
  display,
  onClick,
  title,
}: {
  label: string;
  /** The raw magnitude, which sets the bar's length. */
  value: number;
  /** The largest value in this group, which sets the scale. */
  of: number;
  tone?: Tone;
  /**
   * What to print beside the bar, where the raw number is not what a reader
   * should see. A duration of 0.0006 seconds is a real magnitude and "0" is a
   * wrong reading of it.
   */
  display?: string;
  onClick?: () => void;
  title?: string;
}) {
  const share = of > 0 ? Math.max(0, Math.min(1, value / of)) : 0;
  const Row = onClick ? "button" : "div";
  return (
    <Row
      {...(onClick ? { type: "button" as const, onClick } : {})}
      title={title}
      className={cn(
        "move-state group flex w-full items-center gap-3 rounded-sm px-1.5 py-1 text-left",
        onClick && "hover:bg-hover"
      )}
    >
      <span className="w-bar-label shrink-0 truncate type-caption text-text-2">{label}</span>
      <span
        aria-hidden
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-2"
      >
        {/* Square at the baseline, rounded at the data-end. */}
        <span
          className={cn("block h-full rounded-r-sm", FILL[tone])}
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <span className={cn("figures w-bar-value shrink-0 text-right type-caption", INK[tone])}>
        {display ?? count(value)}
      </span>
    </Row>
  );
}
