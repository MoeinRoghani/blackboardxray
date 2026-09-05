/**
 * One run, on its spine.
 *
 * Two panes at `lg`, which is where two panes stop fitting and is the only
 * reason that breakpoint exists. Below it the inspector becomes a panel under
 * the spine rather than beside it.
 */
import { ArrowLeft, ListTree } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge, LiveDot } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Inspector } from "@/components/Inspector";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Spine } from "@/components/Spine";
import { EmptyState, ErrorState } from "@/components/States";
import { useRun, useRunEvents } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  EVENT_KINDS,
  KIND_LABEL,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  changedTheBoard,
  type EventKind,
  type RunEvent,
} from "@/lib/events";
import { count, duration, instant } from "@/lib/format";

export function RunDetail() {
  const { boardId = "" } = useParams();
  const run = useRun(boardId);
  const isOpen = run.data ? run.data.outcome === null : false;
  const events = useRunEvents(boardId, isOpen);
  const [selected, setSelected] = useState<RunEvent | null>(null);
  const [hidden, setHidden] = useState<Set<EventKind>>(new Set());

  const shown = useMemo(
    () => (events.data?.events ?? []).filter((event) => !hidden.has(event.kind)),
    [events.data, hidden]
  );

  const present = useMemo(() => {
    const seen = new Map<EventKind, number>();
    for (const event of events.data?.events ?? []) {
      seen.set(event.kind, (seen.get(event.kind) ?? 0) + 1);
    }
    return seen;
  }, [events.data]);

  if (run.isError) {
    return (
      <>
        <BackLink />
        <ErrorState error={run.error} />
      </>
    );
  }

  const onSpine = shown.filter(changedTheBoard).length;

  return (
    <>
      <BackLink />
      <PageHeader
        title={<span className="numeric">{boardId}</span>}
        meta={
          run.data ? (
            <>
              {run.data.outcome === null ? (
                <Badge tone="open">
                  <LiveDot />
                  Open
                </Badge>
              ) : (
                <Badge tone={OUTCOME_TONE[run.data.outcome]}>
                  {OUTCOME_LABEL[run.data.outcome]}
                </Badge>
              )}
              <span className="numeric">
                {count(run.data.last_sequence)} on the board
              </span>
              <span>{run.data.agents.length} agents</span>
              {run.data.opened_at ? (
                <span title={run.data.opened_at}>
                  opened {instant(run.data.opened_at)}
                </span>
              ) : null}
              {run.data.opened_at && run.data.closed_at ? (
                <span className="numeric">
                  ran{" "}
                  {duration(
                    (Date.parse(run.data.closed_at) -
                      Date.parse(run.data.opened_at)) /
                      1000
                  )}
                </span>
              ) : null}
            </>
          ) : null
        }
      />

      {run.data ? <Verdict run={run.data} /> : null}

      <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle pb-3">
            <p className="type-caption text-text-secondary">
              <span className="numeric text-text-primary">{onSpine}</span> changed
              the board.{" "}
              <span className="numeric text-text-primary">
                {shown.length - onSpine}
              </span>{" "}
              were the run acting on it.
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {EVENT_KINDS.filter((kind) => present.has(kind)).map((kind) => {
                const off = hidden.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() =>
                      setHidden((current) => {
                        const next = new Set(current);
                        if (next.has(kind)) next.delete(kind);
                        else next.add(kind);
                        return next;
                      })
                    }
                    aria-pressed={!off}
                    className={cn(
                      "rounded-sm border px-1.5 py-0.5 type-caption",
                      "transition-colors duration-fast ease-standard",
                      off
                        ? "border-border-subtle text-text-secondary line-through"
                        : "border-border-default bg-surface-raised text-text-primary"
                    )}
                  >
                    {KIND_LABEL[kind]}{" "}
                    <span className="numeric">{present.get(kind)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {events.isLoading ? (
            <div className="flex flex-col gap-2 py-4">
              {Array.from({ length: 10 }, (_, index) => (
                <Skeleton key={index} className="h-6 w-full" />
              ))}
            </div>
          ) : null}

          {events.isError ? <ErrorState error={events.error} className="mt-4" /> : null}

          {events.data && shown.length === 0 ? (
            <EmptyState icon={ListTree} title="Nothing to show" className="mt-4">
              {events.data.events.length
                ? "Every event kind is hidden. Turn one back on above."
                : "This run has no events yet. It appears here the moment one arrives."}
            </EmptyState>
          ) : null}

          {shown.length > 0 ? (
            <Spine
              events={shown}
              selected={selected?.id ?? null}
              onSelect={(event) =>
                setSelected((current) => (current?.id === event.id ? null : event))
              }
            />
          ) : null}
        </section>

        {selected ? (
          <div className="w-full border-t border-border-subtle lg:sticky lg:top-0 lg:max-h-dvh lg:w-inspector lg:border-t-0">
            <Inspector event={selected} onClose={() => setSelected(null)} />
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * What the run came to, stated before the timeline.
 *
 * An aborted run leads with the caller's own reason string, and a run that
 * left agents unfinished names them. Neither is softened, because an operator
 * reading this is deciding whether something is wrong.
 */
function Verdict({ run }: { run: NonNullable<ReturnType<typeof useRun>["data"]> }) {
  if (run.outcome === null) return null;
  const problems: string[] = [];
  if (run.unfinished.length) {
    problems.push(
      `${run.unfinished.join(", ")} still held an unacknowledged notification when the run closed.`
    );
  }
  if (run.n_failed) {
    problems.push(
      `${run.n_failed} ${run.n_failed === 1 ? "notification" : "notifications"} never reached the agent they were for.`
    );
  }
  if (run.outcome === "aborted" && run.reason) {
    problems.unshift(run.reason);
  }
  if (run.outcome === "wall_clock_expired") {
    problems.unshift(
      `The wall clock limit of ${duration(run.limits.wall_clock_seconds ?? null)} passed while the run was open.`
    );
  }
  if (!problems.length) return null;
  const tone = run.outcome === "aborted" || run.n_failed ? "aborted" : "expired";
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-1 rounded-md border p-4",
        tone === "aborted"
          ? "border-aborted-border bg-aborted-bg"
          : "border-expired-border bg-expired-bg"
      )}
    >
      {problems.map((line) => (
        <p
          key={line}
          className={cn(
            "type-small",
            tone === "aborted" ? "text-aborted-text" : "text-expired-text"
          )}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

function BackLink() {
  return (
    <Button emphasis="ghost" size="sm" asChild className="mb-3 -ml-2">
      <Link to="/runs">
        <ArrowLeft aria-hidden className="size-3.5" />
        Runs
      </Link>
    </Button>
  );
}
