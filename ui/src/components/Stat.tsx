/**
 * A number and what it counts.
 *
 * There is no card around it. At this density a card is six borders and a
 * shadow doing the work one gap already did, so the counts sit in a hairline
 * rail with the thing they count.
 */
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import { count } from "@/lib/format";
import type { Tone } from "@/lib/events";

const TONE: Record<Tone, string> = {
  neutral: "text-text-primary",
  settled: "text-settled-text",
  expired: "text-expired-text",
  aborted: "text-aborted-text",
  open: "text-open-text",
};

export function Stat({
  label,
  value,
  tone = "neutral",
  to,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: Tone;
  to?: string;
  hint?: string;
}) {
  const body = (
    <>
      <span className="type-label text-text-secondary">{label}</span>
      <span className={cn("numeric type-display", TONE[tone])}>
        {typeof value === "number" ? count(value) : value}
      </span>
      {hint ? <span className="type-caption text-text-secondary">{hint}</span> : null}
    </>
  );
  const shape = "flex flex-col gap-1 px-4 py-3 first:pl-0";
  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          shape,
          "rounded-sm transition-colors duration-fast ease-standard",
          "hover:bg-surface-hover"
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={shape}>{body}</div>;
}

export function StatRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap divide-x divide-border-subtle border-b border-border-subtle pb-4">
      {children}
    </div>
  );
}
