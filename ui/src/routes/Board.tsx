/**
 * One board, three readings of the same run.
 *
 * Graph is the shape of it, Events is the record, Board is what was written.
 * They are views and not screens: the run's clock stays along the bottom
 * whichever is showing, so moving between them never loses the reader's place
 * in the run.
 *
 * The graph is a reading. The events are the record. Where they disagree the
 * events are right, and that is why the toggle is always present rather than
 * the graph being a thing you leave the run to see.
 */
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Frame } from "@/components/Frame";
import { RunGraph } from "@/components/RunGraph";
import { RunTimeline } from "@/components/RunTimeline";
import { EventTable } from "@/components/EventTable";
import { BoardContents } from "@/components/BoardContents";
import { cn } from "@/lib/cn";
import { ago, between, count, duration } from "@/lib/format";
import { OUTCOME_LABEL, runTone, type RunEvent } from "@/lib/events";
import { Dot } from "@/components/Dot";
import { useRun, useRunEvents } from "@/lib/api";

const VIEWS = [
  { id: "graph", label: "Graph" },
  { id: "events", label: "Events" },
  { id: "board", label: "Board" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

export function Board() {
  const { boardId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((one) => one.id === params.get("view"))?.id ?? "graph") as ViewId;

  const run = useRun(boardId);
  const open = run.data ? run.data.outcome === null : false;
  const events = useRunEvents(boardId, open);

  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<RunEvent | null>(null);

  const list = useMemo(() => events.data?.events ?? [], [events.data]);

  // Pointing at an event in the clock lights the agent that caused it in the
  // graph. One gesture, two views, which is the reason they share a surface.
  const lit = selected?.agent ?? focus;

  return (
    <Frame>
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="band band-under flex items-center gap-3 px-2 py-2.5">
          <Link
            to="/"
            className="move-state flex h-6 items-center gap-1 rounded-sm px-1.5 type-caption text-text-2 hover:bg-hover hover:text-text"
          >
            <ChevronLeft size={13} aria-hidden />
            Boards
          </Link>
          <span aria-hidden className="h-4 w-px bg-hairline" />

          <span className="flex min-w-0 items-center gap-2">
            <Dot tone={runTone(run.data?.outcome ?? null)} big />
            <h1 className="code truncate type-small text-text">{boardId}</h1>
          </span>

          {run.data ? (
            <p className="truncate type-caption text-text-2 max-md:hidden">
              {open
                ? `open, ${ago(run.data.opened_at)}`
                : OUTCOME_LABEL[run.data.outcome!].toLowerCase()}
              {run.data.opened_at
                ? `, ${duration(
                    between(run.data.opened_at, run.data.closed_at ?? run.data.last_event_at)
                  )}`
                : ""}
              {`, ${count(run.data.n_writes)} writes, seq ${count(run.data.last_sequence)}`}
            </p>
          ) : null}

          <span className="flex-1" />

          <div
            className="flex items-center rounded-sm border border-edge bg-plane p-1"
            role="tablist"
            aria-label="How to read this run"
          >
            {VIEWS.map((one) => (
              <button
                key={one.id}
                type="button"
                role="tab"
                aria-selected={view === one.id}
                onClick={() =>
                  setParams(
                    (current) => {
                      const draft = new URLSearchParams(current);
                      draft.set("view", one.id);
                      return draft;
                    },
                    { replace: true }
                  )
                }
                className={cn(
                  "move-state rounded-sm px-2 type-caption",
                  view === one.id ? "bg-active text-text" : "text-text-2 hover:text-text"
                )}
              >
                {one.label}
              </button>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 bg-field">
          {run.isError ? (
            <p className="p-4 type-small text-bad">{run.error.message}</p>
          ) : !run.data ? (
            <p className="p-4 type-small text-text-2">Loading the run.</p>
          ) : view === "graph" ? (
            <RunGraph run={run.data} events={list} focus={lit} onFocus={setFocus} />
          ) : view === "events" ? (
            <EventTable
              events={list}
              openedAt={run.data.opened_at}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <BoardContents run={run.data} events={list} />
          )}
        </div>

        <RunTimeline
          events={list}
          openedAt={run.data?.opened_at ?? null}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
    </Frame>
  );
}
