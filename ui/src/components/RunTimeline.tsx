/**
 * The run along its own clock.
 *
 * One tick per event, placed by when it happened rather than by its position
 * in a list. That difference is the point: a list of four hundred events looks
 * evenly paced, and this shows the two bursts and the ninety seconds of
 * nothing between them, which is what an idle deadline expiring looks like.
 *
 * Height carries what changed the board. A write took a sequence number and is
 * part of the record, so it is a full height tick; a notification, an
 * acknowledgment or a refusal took no number and is a half height one. Colour
 * is only ever spent on the two kinds that carry a problem.
 */
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { count, duration, since } from "@/lib/format";
import { KIND_LABEL, KIND_TONE, changedTheBoard, type RunEvent } from "@/lib/events";
import type { Tone } from "@/lib/events";

interface Tick {
  event: RunEvent;
  at: number;
  tone: Tone;
  /** Took a sequence number, so it is part of the board's own record. */
  onTheRecord: boolean;
}

// Height says what changed the board; colour says what went wrong. A write
// that landed is the tallest neutral tick, a refusal is a short amber one.
const HEIGHT: Record<Tone, string> = {
  neutral: "h-1/3 bg-edge-strong",
  live: "h-1/2 bg-live-solid",
  ok: "h-1/2 bg-ok-solid",
  warn: "h-2/3 bg-warn-solid",
  bad: "h-full bg-bad-solid",
};

export function RunTimeline({
  events,
  openedAt,
  selected,
  onSelect,
}: {
  events: RunEvent[];
  openedAt: string | null;
  selected: RunEvent | null;
  onSelect: (event: RunEvent | null) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(0);

  const { ticks, span } = useMemo(() => {
    if (events.length === 0) return { ticks: [] as Tick[], span: 1 };
    const first = Date.parse(openedAt ?? events[0].at);
    const last = Date.parse(events[events.length - 1].at);
    const width = Math.max(1, last - first);
    return {
      ticks: events.map((event) => ({
        event,
        at: (Date.parse(event.at) - first) / width,
        tone: KIND_TONE[event.kind],
        onTheRecord: changedTheBoard(event),
      })),
      span: width / 1000,
    };
  }, [events, openedAt]);

  const reading = selected ?? (ticks[cursor]?.event ?? null);

  return (
    <section
      aria-label="The run along its clock"
      className="band band-over grid h-timeline grid-rows-[auto_minmax(0,1fr)] px-3 py-2"
    >
      <header className="flex items-baseline justify-between gap-3 pb-1.5">
        <p className="type-caption text-text-2">
          <span className="figures text-text">{count(events.length)}</span> events over{" "}
          <span className="figures text-text">{duration(span)}</span>
        </p>
        <p aria-live="polite" className="truncate type-caption text-text-2">
          {reading ? (
            <>
              <span className="figures">{since(openedAt, reading.at)}</span>{" "}
              <span className="text-text">{KIND_LABEL[reading.kind]}</span>
              {reading.agent ? ` by ${reading.agent}` : ""}
              {reading.region ? ` on ${reading.region}` : ""}
              {reading.sequence ? (
                <span className="figures text-text-2">{` seq ${reading.sequence}`}</span>
              ) : null}
            </>
          ) : (
            "Point at a tick to read it"
          )}
        </p>
      </header>

      <div
        ref={track}
        role="group"
        aria-label={`${events.length} events. Use the arrow keys to step through them.`}
        tabIndex={0}
        onKeyDown={(keyed) => {
          const last = ticks.length - 1;
          let next = cursor;
          if (keyed.key === "ArrowRight") next = Math.min(last, cursor + 1);
          else if (keyed.key === "ArrowLeft") next = Math.max(0, cursor - 1);
          else if (keyed.key === "Home") next = 0;
          else if (keyed.key === "End") next = last;
          else return;
          keyed.preventDefault();
          setCursor(next);
          onSelect(ticks[next]?.event ?? null);
        }}
        onPointerLeave={() => onSelect(null)}
        className="well relative min-h-0 overflow-hidden"
      >
        {/* The baseline every tick stands on. Without it a sparse run reads as
            a scatter of marks rather than as a line with gaps in it. */}
        <span aria-hidden className="absolute inset-x-2 bottom-2 h-px bg-hairline" />

        {/* The ticks sit inside an inset layer so that the first and the last,
            which land at nought and one hundred percent, are drawn whole. Run
            opened and run closed were each half a tick wide against the edge. */}
        <div className="absolute inset-x-2 inset-y-0">
        {ticks.map((tick, index) => {
          const on = selected?.id === tick.event.id;
          return (
            <button
              key={tick.event.id}
              type="button"
              tabIndex={-1}
              aria-label={`${since(openedAt, tick.event.at)}, ${KIND_LABEL[tick.event.kind]}${
                tick.event.agent ? ` by ${tick.event.agent}` : ""
              }`}
              onPointerEnter={() => {
                setCursor(index);
                onSelect(tick.event);
              }}
              onClick={() => onSelect(on ? null : tick.event)}
              className="absolute inset-y-0 z-10 w-2 -translate-x-1/2"
              // Data, not a design value: the position is the measurement.
              style={{ left: `${tick.at * 100}%` }}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-2 left-1/2 w-px -translate-x-1/2",
                  HEIGHT[tick.tone],
                  tick.onTheRecord && tick.tone === "neutral" && "h-3/4 bg-live-solid",
                  on && "w-0.5 bg-text"
                )}
              />
            </button>
          );
        })}

        </div>

        {ticks.length === 0 ? (
          <p className="p-2 type-caption text-text-2">No event has arrived for this run yet.</p>
        ) : null}
      </div>
    </section>
  );
}
