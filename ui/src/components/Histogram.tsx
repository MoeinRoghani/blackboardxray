/**
 * Runs opened over time, split by how they ended.
 *
 * The chart is the first thing on the index because it answers the first
 * question: is the shape of the last day normal. It is continuous, so an
 * interval in which nothing opened is a gap in the row and not a missing bar,
 * and it is a control rather than a picture: a bar filters the table beneath
 * it to the runs it counts.
 *
 * On colour. Four outcomes carry four hues, and two of them are amber and red,
 * which no colour-blind reader can separate reliably when they are stacked
 * against each other. So the stack is never the only carrier: the facet strip
 * directly below names every outcome in words with its own count and swatch,
 * and the readout names the interval's counts in words as well. The hue is
 * reinforcement of a legend that is permanently on screen, which is the same
 * rule the rest of the product's state colours follow.
 *
 * The stack is ordered with trouble at the bottom. Segments that share a
 * baseline are the only ones a reader can compare across bars, and comparing
 * trouble across bars is what this chart is for.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { count } from "@/lib/format";
import type { Bucket, Histogram as Data } from "@/lib/api";

/** Bottom of the stack first, so trouble shares the baseline. */
const SERIES = [
  { key: "aborted", label: "aborted", fill: "bg-bad-solid", text: "text-bad" },
  { key: "expired", label: "expired", fill: "bg-warn-solid", text: "text-warn" },
  { key: "settled", label: "settled", fill: "bg-ok-solid", text: "text-ok" },
  { key: "open", label: "open", fill: "bg-live-solid", text: "text-live" },
] as const;

export interface Range {
  since: string;
  until: string;
}

function total(bucket: Bucket): number {
  return bucket.open + bucket.settled + bucket.aborted + bucket.expired;
}

function endOf(bucket: Bucket, step: number): string {
  return new Date(Date.parse(bucket.at) + step * 1000).toISOString();
}

function interval(bucket: Bucket, step: number): string {
  const from = new Date(bucket.at);
  const to = new Date(Date.parse(bucket.at) + step * 1000);
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = step >= 3600 ? `${from.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ` : "";
  return `${day}${time(from)} to ${time(to)}`;
}

export function Histogram({
  data,
  loading,
  range,
  onRange,
}: {
  data: Data | undefined;
  loading: boolean;
  range: Range | null;
  onRange: (range: Range | null) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const bars = useRef<HTMLDivElement>(null);

  const buckets = data?.buckets ?? [];
  const step = data?.step_seconds ?? 60;
  const peak = useMemo(() => Math.max(1, ...buckets.map(total)), [buckets]);

  const selected = useMemo(() => {
    if (!range) return -1;
    return buckets.findIndex((b) => b.at === range.since || Date.parse(b.at) === Date.parse(range.since));
  }, [buckets, range]);

  // The readout shows what the pointer is over, and falls back to what is
  // selected, and then to the whole window. It never shows nothing, so the
  // corner does not flicker between a value and an empty box as a pointer
  // crosses the chart.
  const readingAt = hovered ?? (selected >= 0 ? selected : null);
  const reading = readingAt !== null ? buckets[readingAt] : undefined;

  const pick = useCallback(
    (index: number) => {
      const bucket = buckets[index];
      if (!bucket) return;
      const already = range && Date.parse(range.since) === Date.parse(bucket.at);
      onRange(already ? null : { since: bucket.at, until: endOf(bucket, step) });
    },
    [buckets, onRange, range, step]
  );

  // Roving tabindex: the row is one tab stop and the arrows move inside it.
  // Ninety-six bars as ninety-six tab stops would make the chart the longest
  // thing on the page to get past.
  const onKey = useCallback(
    (event: React.KeyboardEvent) => {
      const last = buckets.length - 1;
      let next = cursor;
      if (event.key === "ArrowRight") next = Math.min(last, cursor + 1);
      else if (event.key === "ArrowLeft") next = Math.max(0, cursor - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pick(cursor);
        return;
      } else return;
      event.preventDefault();
      setCursor(next);
      setHovered(next);
      const node = bars.current?.children[next] as HTMLElement | undefined;
      node?.focus();
    },
    [buckets.length, cursor, pick]
  );

  useEffect(() => {
    if (selected >= 0) setCursor(selected);
  }, [selected]);

  return (
    <section
      aria-label="Runs opened over time"
      className="band band-under grid h-chart grid-cols-1 px-2 py-2"
    >
      <div className="well relative grid grid-rows-[minmax(0,1fr)_auto] overflow-hidden px-2 pt-2 pb-1">
        <Readout
          reading={reading}
          when={reading ? interval(reading, step) : null}
          peak={peak}
          loading={loading}
          empty={!loading && buckets.length > 0 && peak <= 1 && buckets.every((b) => total(b) === 0)}
        />

        <div
          ref={bars}
          role="group"
          aria-label={`${buckets.length} intervals. Use the arrow keys to move between them and Enter to filter the table.`}
          onKeyDown={onKey}
          onPointerLeave={() => setHovered(null)}
          className="flex min-h-0 items-end gap-px"
        >
          {buckets.map((bucket, index) => {
            const height = total(bucket);
            const dim = selected >= 0 && index !== selected;
            return (
              <div
                key={bucket.at}
                role="button"
                tabIndex={index === cursor ? 0 : -1}
                aria-pressed={index === selected}
                aria-label={`${interval(bucket, step)}: ${count(height)} runs. ${SERIES.map(
                  (s) => `${count(bucket[s.key])} ${s.label}`
                ).join(", ")}.`}
                onPointerEnter={() => setHovered(index)}
                onFocus={() => setHovered(index)}
                onClick={() => pick(index)}
                className={cn(
                  "move-state relative flex h-full min-w-px flex-1 cursor-pointer flex-col justify-end rounded-t-sm",
                  dim && "opacity-40",
                  (hovered === index || index === selected) && "opacity-100"
                )}
              >
                {/* The hover column stands the full height so a pointer aims at
                    an interval, not at the top of a short bar. */}
                <span
                  aria-hidden
                  className={cn(
                    "move-state absolute inset-0 rounded-t-sm",
                    hovered === index && "bg-hover",
                    index === selected && "bg-live-wash"
                  )}
                />
                {[...SERIES].reverse().map((series) => {
                  const value = bucket[series.key];
                  if (!value) return null;
                  return (
                    <span
                      key={series.key}
                      aria-hidden
                      className={cn("relative w-full first:rounded-t-sm", series.fill)}
                      // Data, not a design value: the height is the measurement.
                      style={{ height: `${(value / peak) * 100}%` }}
                    />
                  );
                })}
                {height === 0 ? (
                  <span aria-hidden className="relative h-px w-full bg-hairline" />
                ) : null}
              </div>
            );
          })}
          {buckets.length === 0 && loading ? <div className="shimmer h-full w-full rounded-sm bg-hover" /> : null}
        </div>

        <Axis buckets={buckets} step={step} />
      </div>
    </section>
  );
}

/**
 * The corner readout.
 *
 * Fixed in one place rather than following the pointer, because a tooltip that
 * follows a pointer across ninety-six targets is a value that never stops
 * moving, and it covers the bars either side of the one being read.
 */
function Readout({
  reading,
  when,
  peak,
  loading,
  empty,
}: {
  reading: Bucket | undefined;
  when: string | null;
  peak: number;
  loading: boolean;
  empty: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-1 z-10 flex items-start justify-between gap-3">
      <span className="type-caption figures text-text-2" aria-hidden>
        {loading ? "" : empty ? "no runs in this window" : `peak ${count(peak)}`}
      </span>
      <span aria-live="polite" className="flex items-center gap-2 type-caption figures">
        {reading && when ? (
          <>
            <span className="text-text-2">{when}</span>
            {SERIES.map((series) =>
              reading[series.key] ? (
                <span key={series.key} className={cn("flex items-center gap-1", series.text)}>
                  <span aria-hidden className={cn("size-1.5 rounded-sm", series.fill)} />
                  {count(reading[series.key])}
                </span>
              ) : null
            )}
          </>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Four labels, placed where their interval actually is.
 *
 * Spacing them evenly across the row is a lie by a whole bar at each end: the
 * first would sit at the left edge and the last at the right, neither above
 * the bar it names. Each one is positioned at its own bucket's fraction.
 */
function Axis({ buckets, step }: { buckets: Bucket[]; step: number }) {
  const marks = useMemo(() => {
    if (buckets.length < 2) return [];
    const every = Math.max(1, Math.floor(buckets.length / 4));
    return buckets
      .map((bucket, index) => ({ bucket, index }))
      .filter(({ index }) => index % every === 0);
  }, [buckets]);
  const long = step >= 3600;
  return (
    <div className="relative h-4 type-caption figures text-text-2" aria-hidden>
      {marks.map(({ bucket, index }, order) => {
        // A label centred on the first or last interval hangs off the end of
        // the chart. Those two anchor to their edge instead, which keeps the
        // whole row inside the well and still puts each label over its own bar.
        const first = order === 0;
        const last = order === marks.length - 1;
        return (
          <span
            key={bucket.at}
            className={cn(
              "absolute top-1 whitespace-nowrap",
              first ? "left-0" : last ? "right-0" : "-translate-x-1/2"
            )}
            // Data, not a design value: the position is the interval's own.
            style={first || last ? undefined : { left: `${((index + 0.5) / buckets.length) * 100}%` }}
          >
            {new Date(bucket.at).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: long ? undefined : "2-digit",
              hour12: false,
            })}
          </span>
        );
      })}
    </div>
  );
}
