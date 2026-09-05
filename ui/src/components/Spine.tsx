/**
 * The spine: a run as one numbered column, read top to bottom.
 *
 * The product's whole bet is here. `blackboardx` assigns a gapless total order
 * in the store and every write's number is also its address, so there is no
 * ordering to reconstruct out of clocks that disagree. What that buys is a
 * single axis instead of a field of overlapping bars.
 *
 * The axis also carries the distinction the product exists to show. An event
 * that took a sequence number changed the board and sits on the line with its
 * number beside it. An event that took none is something the run did about the
 * board, a notification, an acknowledgment, a refusal, and it hangs off the
 * line. A reader can therefore see, without reading a word, how much of a run
 * was record and how much was control.
 */
import { Fragment } from "react";
import { cn } from "@/lib/cn";
import { clock } from "@/lib/format";
import {
  KIND_LABEL,
  KIND_TONE,
  changedTheBoard,
  type RunEvent,
  type Tone,
} from "@/lib/events";

const NODE_TONE: Record<Tone, string> = {
  neutral: "bg-border-strong",
  settled: "bg-settled-solid",
  expired: "bg-expired-solid",
  aborted: "bg-aborted-solid",
  open: "bg-open-solid",
};

const TEXT_TONE: Record<Tone, string> = {
  neutral: "text-text-primary",
  settled: "text-settled-text",
  expired: "text-expired-text",
  aborted: "text-aborted-text",
  open: "text-open-text",
};

export function Spine({
  events,
  selected,
  onSelect,
}: {
  events: RunEvent[];
  selected: number | null;
  onSelect: (event: RunEvent) => void;
}) {
  return (
    <ol className="relative">
      {events.map((event, index) => (
        <Fragment key={event.id}>
          <SpineRow
            event={event}
            first={index === 0}
            last={index === events.length - 1}
            selected={selected === event.id}
            onSelect={onSelect}
          />
        </Fragment>
      ))}
    </ol>
  );
}

function SpineRow({
  event,
  first,
  last,
  selected,
  onSelect,
}: {
  event: RunEvent;
  first: boolean;
  last: boolean;
  selected: boolean;
  onSelect: (event: RunEvent) => void;
}) {
  const onSpine = changedTheBoard(event);
  const tone = KIND_TONE[event.kind];
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(event)}
        aria-current={selected || undefined}
        className={cn(
          "group flex w-full items-stretch text-left",
          "transition-colors duration-fast ease-standard",
          selected ? "bg-surface-active" : "hover:bg-surface-hover"
        )}
      >
        {/* The gutter carries the address, and only an event that has one. */}
        <span
          className={cn(
            "numeric w-14 shrink-0 py-1.5 pr-3 text-right type-caption",
            onSpine ? "text-text-primary" : "text-transparent"
          )}
        >
          {onSpine ? event.sequence : "."}
        </span>

        {/* The rail: one continuous line, and this event's node on it. */}
        <span className="relative w-6 shrink-0" aria-hidden>
          <span
            className={cn(
              "spine-draw absolute bottom-0 left-3 top-0 border-l border-border-default",
              first && "top-1/2",
              last && "bottom-1/2"
            )}
          />
          <span
            className={cn(
              "absolute left-3 top-1/2 -translate-x-1/2 -translate-y-1/2",
              onSpine
                ? cn("size-2", NODE_TONE[tone])
                : cn(
                    "size-1.5 rounded-full border bg-surface-page",
                    tone === "neutral" ? "border-border-strong" : "border-current",
                    TEXT_TONE[tone]
                  )
            )}
          />
        </span>

        {/* An event that changed the board reads at full weight. One that did
            not is something the run did about it, and reads a step back. */}
        <span
          className={cn(
            "flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 pr-3",
            !onSpine && "pl-4"
          )}
        >
          <span
            className={cn(
              "type-small",
              onSpine ? "font-medium text-text-primary" : "text-text-secondary",
              tone !== "neutral" && TEXT_TONE[tone]
            )}
          >
            {KIND_LABEL[event.kind]}
          </span>
          {event.region ? (
            <span className="numeric type-caption text-text-secondary">
              {event.region}
            </span>
          ) : null}
          <Detail event={event} />
        </span>

        <span className="hidden shrink-0 items-baseline gap-3 py-1.5 pr-4 sm:flex">
          <span className="type-caption text-text-secondary">
            {event.agent ?? ""}
          </span>
          <span className="numeric w-24 text-right type-caption text-text-secondary">
            {clock(event.at)}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The one fact about this event that is worth a row of its own.
 *
 * A refusal shows the rule's reason verbatim, because a paraphrase of it is
 * the operator's actual question answered wrongly.
 */
function Detail({ event }: { event: RunEvent }) {
  switch (event.kind) {
    case "write.refused":
      return (
        <span className="type-caption text-expired-text">{event.body.reason}</span>
      );
    case "write.conflicted":
      return (
        <span className="numeric type-caption text-expired-text">
          expected v{event.body.expected_version}, found v{event.body.current_version}
        </span>
      );
    case "notification.dispatched":
      return (
        <span className="numeric type-caption text-text-secondary">
          {event.body.from_sequence}..{event.body.to_sequence}
        </span>
      );
    case "notification.failed":
      return (
        <span className="type-caption text-aborted-text">{event.body.detail}</span>
      );
    case "notification.acknowledged":
      return (
        <span className="numeric type-caption text-text-secondary">
          notification {event.body.notification_id}
        </span>
      );
    case "premise.set":
      return event.body.version !== null ? (
        <span className="numeric type-caption text-text-secondary">
          v{event.body.version}
        </span>
      ) : null;
    case "run.closed":
      return (
        <span className="type-caption text-text-secondary">
          {event.body.outcome.replace(/_/g, " ")}
          {event.body.unfinished.length
            ? `, unfinished ${event.body.unfinished.join(", ")}`
            : ""}
        </span>
      );
    case "agent.registered":
      return (
        <span className="type-caption text-text-secondary">
          {event.body.at_creation ? "at creation" : "joined a run under way"}
        </span>
      );
    default:
      return null;
  }
}
