/**
 * The selected run, filling the canvas beside the list.
 *
 * The verdict comes before the events, because an operator opening a run is
 * deciding whether something is wrong and the answer should not be at the
 * bottom of a table.
 */
import { Activity, ChevronLeft, ListTree } from "lucide-react";
import { useMemo, useState } from "react";
import { RunState, State } from "@/components/State";
import { Skeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import { useRun, useRunEvents, type Run } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  KIND_LABEL,
  changedTheBoard,
  type EventKind,
  type RunEvent,
} from "@/lib/events";
import { clock, count, duration, instant } from "@/lib/format";

/** One control restructures the pane, rather than a row of chips that do not. */
const REGISTERS = [
  { id: "all", label: "Everything" },
  { id: "board", label: "What landed" },
  { id: "control", label: "What the run did" },
  { id: "trouble", label: "Trouble" },
] as const;

type Register = (typeof REGISTERS)[number]["id"];

const TROUBLE: EventKind[] = [
  "write.refused",
  "write.conflicted",
  "notification.failed",
];

export function RunPane({
  boardId,
  onEvent,
  onAgent,
  onBackToList,
}: {
  boardId: string;
  onEvent: (event: RunEvent) => void;
  onAgent: (name: string) => void;
  /** Below md the list is not on screen, so the pane owes a way back to it. */
  onBackToList: () => void;
}) {
  const run = useRun(boardId);
  const isOpen = run.data ? run.data.outcome === null : false;
  const events = useRunEvents(boardId, isOpen);
  const [register, setRegister] = useState<Register>("all");

  const shown = useMemo(() => {
    const all = events.data?.events ?? [];
    if (register === "board") return all.filter(changedTheBoard);
    if (register === "control") return all.filter((one) => !changedTheBoard(one));
    if (register === "trouble") return all.filter((one) => TROUBLE.includes(one.kind));
    return all;
  }, [events.data, register]);

  if (run.isError) return <ErrorState error={run.error} className="m-6" />;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">
      {run.isLoading || !run.data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="mt-4 h-64 w-full" />
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={onBackToList}
            className="move-state -ml-1 mb-2 inline-flex items-center gap-0.5 rounded-sm px-1 py-1 type-small text-live md:hidden"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            Runs
          </button>
          <h1 className="code type-display font-semibold">{run.data.board_id}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2.5">
            <RunState outcome={run.data.outcome} />
            <span className="figures type-caption text-text-2">
              {count(run.data.last_sequence)} on board
            </span>
            <button
              type="button"
              onClick={() => run.data && onAgent(run.data.agents[0] ?? "")}
              disabled={!run.data.agents.length}
              className="move-state type-caption text-text-2 underline-offset-2 hover:text-text hover:underline disabled:no-underline"
            >
              {run.data.agents.length} agents
            </button>
            {run.data.opened_at ? (
              <span className="type-caption text-text-2">
                {instant(run.data.opened_at)}
              </span>
            ) : null}
            {run.data.opened_at && run.data.closed_at ? (
              <span className="figures type-caption text-text-2">
                ran{" "}
                {duration(
                  (Date.parse(run.data.closed_at) - Date.parse(run.data.opened_at)) /
                    1000
                )}
              </span>
            ) : null}
          </div>

          <Verdict run={run.data} onAgent={onAgent} />

          <div className="flex flex-wrap items-center gap-1 pt-6">
            {REGISTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={register === option.id}
                onClick={() => setRegister(option.id)}
                className={cn(
                  "move-state rounded-sm border px-2 py-1 type-caption",
                  register === option.id
                    ? "border-edge-strong bg-surface-2 font-medium text-text"
                    : "border-transparent text-text-2 hover:bg-hover hover:text-text"
                )}
              >
                {option.label}
              </button>
            ))}
            <span className="ml-auto figures type-caption text-text-2">
              {count(shown.length)} of {count(events.data?.events.length ?? 0)}
            </span>
          </div>

          <div className="plane mt-3 overflow-hidden">
            {events.isLoading ? (
              <div className="flex flex-col gap-px p-1">
                {Array.from({ length: 8 }, (_, index) => (
                  <Skeleton key={index} className="h-8 w-full" />
                ))}
              </div>
            ) : null}
            {events.isError ? <ErrorState error={events.error} className="m-3" /> : null}
            {events.data && shown.length === 0 ? (
              <EmptyState
                icon={register === "all" ? Activity : ListTree}
                title="Nothing here"
                className="m-3"
              >
                {register === "all"
                  ? "This run has no events yet. One appears the moment it arrives."
                  : "Nothing in this view. Try Everything."}
              </EmptyState>
            ) : null}
            {shown.map((event) => (
              <EventRow key={event.id} event={event} onOpen={onEvent} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EventRow({
  event,
  onOpen,
}: {
  event: RunEvent;
  onOpen: (event: RunEvent) => void;
}) {
  const landed = changedTheBoard(event);
  const trouble = TROUBLE.includes(event.kind);
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className="move-state flex w-full items-center gap-3 border-b border-hairline px-3 py-2 text-left last:border-b-0 hover:bg-hover"
    >
      <span
        className={cn(
          "figures w-7 shrink-0 text-right type-caption",
          landed ? "text-text" : "text-transparent"
        )}
      >
        {landed ? event.sequence : "."}
      </span>
      <span
        className={cn(
          "w-44 shrink-0 truncate type-small",
          trouble
            ? event.kind === "notification.failed"
              ? "font-medium text-bad"
              : "font-medium text-warn"
            : landed
              ? "font-medium text-text"
              : "text-text-2"
        )}
      >
        {KIND_LABEL[event.kind]}
      </span>
      <span className="code hidden w-24 shrink-0 truncate text-text-2 sm:block">
        {event.region ?? ""}
      </span>
      <span className="hidden w-20 shrink-0 truncate type-caption text-text-2 md:block">
        {event.agent ?? ""}
      </span>
      <span className="code min-w-0 flex-1 truncate text-text-2">{detail(event)}</span>
      <span className="figures hidden shrink-0 type-caption text-text-2 lg:block">
        {clock(event.at)}
      </span>
    </button>
  );
}

function detail(event: RunEvent): string {
  switch (event.kind) {
    case "write.refused":
      return event.body.reason;
    case "write.conflicted":
      return `expected v${event.body.expected_version}, found v${event.body.current_version}`;
    case "notification.failed":
      return event.body.detail;
    case "notification.dispatched":
      return `covers ${event.body.from_sequence} to ${event.body.to_sequence}`;
    case "notification.acknowledged":
      return `notification ${event.body.notification_id}`;
    case "write.admitted":
    case "premise.set": {
      const carried = event.body.content;
      if (carried?.content !== undefined) return JSON.stringify(carried.content);
      if (carried?.preview) return carried.preview;
      return `${carried?.type ?? "content"}, ${carried?.bytes ?? 0} B`;
    }
    case "run.closed":
      return event.body.unfinished.length
        ? `${event.body.outcome.replace(/_/g, " ")}, unfinished ${event.body.unfinished.join(", ")}`
        : event.body.outcome.replace(/_/g, " ");
    case "agent.registered":
      return event.body.at_creation ? "at creation" : "joined a run under way";
    case "run.opened":
      return `${event.body.regions?.length ?? 0} regions, ${event.body.agents?.length ?? 0} agents`;
    default:
      return "";
  }
}

/** What went wrong, before the table rather than after it. */
function Verdict({ run, onAgent }: { run: Run; onAgent: (name: string) => void }) {
  const lines: React.ReactNode[] = [];
  if (run.outcome === "aborted" && run.reason) lines.push(run.reason);
  if (run.outcome === "wall_clock_expired") {
    lines.push(
      `The wall clock limit of ${duration(run.limits.wall_clock_seconds ?? null)} passed while the run was open.`
    );
  }
  if (run.unfinished.length) {
    lines.push(
      <>
        {run.unfinished.map((name, index) => (
          <span key={name}>
            {index ? ", " : ""}
            <button
              type="button"
              onClick={() => onAgent(name)}
              className="underline underline-offset-2 hover:opacity-80"
            >
              {name}
            </button>
          </span>
        ))}{" "}
        still held an unacknowledged notification when the run closed.
      </>
    );
  }
  if (run.n_failed) {
    lines.push(
      `${count(run.n_failed)} ${run.n_failed === 1 ? "notification" : "notifications"} never reached the agent they were for.`
    );
  }
  if (!lines.length) return null;
  const severe = run.outcome === "aborted" || run.n_failed > 0;
  return (
    <div
      className={cn(
        "rise mt-5 rounded-lg border px-4 py-3",
        severe ? "border-bad-edge bg-bad-wash" : "border-edge bg-warn-wash"
      )}
    >
      <div className="flex flex-col gap-1">
        {lines.map((line, index) => (
          <p key={index} className={cn("type-small", severe ? "text-bad" : "text-warn")}>
            {index === 0 ? (
              <State tone={severe ? "bad" : "warn"} className="mr-1.5 align-middle">
                <span className="sr-only">Problem</span>
              </State>
            ) : null}
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
