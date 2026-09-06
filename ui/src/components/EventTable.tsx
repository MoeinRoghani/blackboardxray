/**
 * The record, in order.
 *
 * This is the source of truth the graph is a reading of, so it is a table and
 * not a feed: fixed rows, one line each, every column aligned against the one
 * above it. It virtualises for the same reason the board table does, because a
 * busy run carries thousands of events.
 *
 * The offset column is the run's own clock rather than the wall clock. Thirty
 * rows all reading 11:24:47.7 and differing in one digit is not a measurement
 * anyone can read; the distance from the run opening is.
 */
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/cn";
import { bytes, since } from "@/lib/format";
import { KIND_LABEL, KIND_TONE, type RunEvent } from "@/lib/events";
import { TEXT } from "@/components/Dot";

const COLUMNS = "cols-events";

export function EventTable({
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
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: events.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 32,
    overscan: 14,
  });

  return (
    <div ref={scroller} className="plane scroll-end min-h-0 overflow-auto">
      <div className="min-w-table-narrow">
      <div
        role="row"
        className={cn(
          "sticky top-0 z-20 grid items-center gap-2 border-b border-rule bg-plane-2 px-3 py-1.5 type-label",
          COLUMNS
        )}
      >
        <span className="text-right">Offset</span>
        <span className="text-right">Seq</span>
        <span>What happened</span>
        <span>Agent</span>
        <span>Region</span>
        <span>Detail</span>
      </div>

      <div>
        {events.length === 0 ? (
          <p className="px-3 py-6 type-small text-text-2">No event has arrived for this run.</p>
        ) : null}
        <div className="relative w-full" style={{ height: `${rows.getTotalSize()}px` }}>
          {rows.getVirtualItems().map((item) => {
            const event = events[item.index];
            return (
              <div
                key={event.id}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Row
                  event={event}
                  openedAt={openedAt}
                  selected={selected?.id === event.id}
                  onSelect={onSelect}
                />
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
}

function Row({
  event,
  openedAt,
  selected,
  onSelect,
}: {
  event: RunEvent;
  openedAt: string | null;
  selected: boolean;
  onSelect: (event: RunEvent | null) => void;
}) {
  // Which kinds carry a problem is decided once, in the vocabulary both halves
  // share, and the wire mirror test fails if a kind is added without one.
  const tone = KIND_TONE[event.kind];

  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(selected ? null : event)}
      onKeyDown={(keyed) => {
        if (keyed.key === "Enter" || keyed.key === " ") {
          keyed.preventDefault();
          onSelect(selected ? null : event);
        }
      }}
      className={cn(
        "row move-state grid h-row cursor-pointer items-center gap-2 px-3 type-caption",
        COLUMNS
      )}
    >
      <span className="figures text-right text-text-2">{since(openedAt, event.at)}</span>
      <span className="figures text-right text-text-2">{event.sequence ?? ""}</span>
      <span className={cn("truncate", TEXT[tone])}>
        {KIND_LABEL[event.kind]}
      </span>
      <span className="truncate text-text-2">{event.agent ?? ""}</span>
      <span className="truncate text-text-2">{event.region ?? ""}</span>
      <span className="truncate text-text-2">{detail(event)}</span>
    </div>
  );
}

/**
 * The one thing about this event a reader would otherwise open it to learn.
 *
 * Every field is treated as possibly absent. Decoding is deliberately tolerant
 * on both sides of the wire, so an event sent by an older client reaches this
 * with fields this build knows about and it does not carry. Reading one
 * straight into a template printed the word "undefined" in a column an
 * operator was relying on, which is worse than printing nothing.
 */
function detail(event: RunEvent): string {
  switch (event.kind) {
    case "run.opened": {
      const regions = event.body.regions?.length;
      return [
        regions === undefined ? null : `${regions} regions`,
        event.body.store ?? null,
      ]
        .filter(Boolean)
        .join(", ");
    }
    case "agent.registered":
      return event.body.subscribes_to?.length
        ? `reads ${event.body.subscribes_to.join(", ")}`
        : "reads nothing";
    case "write.admitted":
    case "premise.set":
      return event.body.content ? bytes(event.body.content.bytes) : "";
    case "write.refused":
      return event.body.reason || event.body.cause || "";
    case "write.conflicted": {
      const current = event.body.current_version;
      if (current === undefined || current === null) return "";
      return `expected ${event.body.expected_version ?? "none"}, found ${current}`;
    }
    case "notification.dispatched": {
      const from = event.body.from_sequence;
      const to = event.body.to_sequence;
      if (from === undefined || to === undefined) return "";
      return from === to ? `sequence ${from}` : `sequences ${from} to ${to}`;
    }
    case "notification.acknowledged":
      return "";
    case "notification.failed":
      return event.body.error ?? "";
    case "run.closed":
      return event.body.reason ?? "";
    default:
      return "";
  }
}
