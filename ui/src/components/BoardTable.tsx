/**
 * The boards, as a record rather than as a feed.
 *
 * A project opens runs continuously, so this is built for thousands of rows:
 * fixed row height, tabular figures, a sticky header, and only the rows in
 * view actually in the document. Cards, a summary box per run, or anything
 * that grows with its content would all be answers to a question nobody has,
 * which is "show me a few runs nicely".
 *
 * Columns are ordered by what is scanned first: what happened, which board,
 * when, then how much work it took. Every number is right aligned against the
 * one above it, which is the only reason a column of numbers is worth having.
 */
import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { ago, between, count, duration } from "@/lib/format";
import { OUTCOME_LABEL, OUTCOME_SHORT, runTone } from "@/lib/events";
import { Dot, TEXT } from "@/components/Dot";
import type { Run } from "@/lib/api";

const COLUMNS = "cols-boards";

export function BoardTable({
  runs,
  total,
  selected,
  loading,
  hasMore,
  fetching,
  onSelect,
  onEnd,
}: {
  runs: Run[];
  total: number;
  selected: string | null;
  loading: boolean;
  hasMore: boolean;
  fetching: boolean;
  onSelect: (boardId: string) => void;
  onEnd: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: runs.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  const items = rows.getVirtualItems();
  const last = items.length ? items[items.length - 1].index : 0;

  useEffect(() => {
    if (hasMore && !fetching && last >= runs.length - 24 && runs.length > 0) onEnd();
  }, [hasMore, fetching, last, runs.length, onEnd]);

  // The header is a real row of the same grid, so a column cannot drift from
  // its heading: they are laid out by one template and not by two.
  // The header lives inside the scrolling box rather than above it. Above it,
  // a table narrower than the viewport cropped its last five columns with no
  // way to reach them; scrolling the two separately would have let a heading
  // drift off the column it names.
  return (
    <div ref={scroller} className="plane scroll-end min-h-0 overflow-auto">
      <div className="min-w-table">
      <div
        role="row"
        className={cn(
          "sticky top-0 z-20 grid items-center gap-2 border-b border-rule bg-plane-2 px-3 py-1.5 type-label",
          COLUMNS
        )}
      >
        <span>Outcome</span>
        <span>Board</span>
        <span>Opened</span>
        <span>Took</span>
        <span className="text-right">Seq</span>
        <span className="text-right">Writes</span>
        <span className="text-right">Refused</span>
        <span className="text-right">Conflicts</span>
        <span className="text-right">Acked</span>
        <span>Agents</span>
      </div>

      <div>
        {loading && runs.length === 0 ? <Loading /> : null}
        {!loading && runs.length === 0 ? (
          <p className="px-3 py-6 type-small text-text-2">
            No board matches this query. Clear a filter, or widen the time window.
          </p>
        ) : null}

        <div className="relative w-full" style={{ height: `${rows.getTotalSize()}px` }}>
          {items.map((item) => {
            const run = runs[item.index];
            return (
              <div
                key={run.board_id}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <Row run={run} selected={run.board_id === selected} onSelect={onSelect} />
              </div>
            );
          })}
        </div>

        <p className="px-3 py-2 type-caption text-text-2" aria-live="polite">
          {fetching && runs.length > 0
            ? "Loading more"
            : hasMore
              ? `${count(runs.length)} of ${count(total)} boards`
              : runs.length > 0
                ? `All ${count(total)} boards`
                : ""}
        </p>
      </div>
      </div>
    </div>
  );
}

function Row({
  run,
  selected,
  onSelect,
}: {
  run: Run;
  selected: boolean;
  onSelect: (boardId: string) => void;
}) {
  const open = run.outcome === null;
  const took = useMemo(() => {
    if (!run.opened_at) return null;
    return between(run.opened_at, run.closed_at ?? run.last_event_at);
  }, [run.opened_at, run.closed_at, run.last_event_at]);
  const stalled = run.unfinished.length > 0;

  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => onSelect(run.board_id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(run.board_id);
        }
      }}
      className={cn(
        "row move-state grid h-row cursor-pointer items-center gap-2 px-3 type-caption",
        COLUMNS
      )}
    >
      <span className="flex items-center gap-1.5 truncate">
        <Dot tone={runTone(run.outcome)} />
        <span
          className={cn("truncate", open && TEXT.live)}
          title={run.outcome === null ? "Open" : OUTCOME_LABEL[run.outcome]}
        >
          {run.outcome === null ? "Open" : OUTCOME_SHORT[run.outcome]}
        </span>
      </span>

      <span className="code flex items-center gap-1.5 truncate text-text">
        <span className="truncate">{run.board_id}</span>
        {stalled ? (
          <AlertTriangle
            size={11}
            className="shrink-0 text-warn"
            aria-label={`${run.unfinished.length} agents did not finish`}
          />
        ) : null}
      </span>

      <span className="figures truncate text-text-2">{ago(run.opened_at)}</span>
      <span className="figures truncate text-text-2">{took === null ? "" : duration(took)}</span>
      <span className="figures text-right text-text-2">{count(run.last_sequence)}</span>
      <span className="figures text-right">{count(run.n_writes)}</span>
      <Trouble value={run.n_refusals} />
      <Trouble value={run.n_conflicts} />
      <span className={cn("figures text-right", run.n_failed > 0 ? "text-bad" : "text-text-2")}>
        {count(run.n_acked)}
        <span className="text-text-2">/{count(run.n_dispatched)}</span>
      </span>
      <span className="truncate text-text-2">{run.agents.join(", ")}</span>
    </div>
  );
}

/** A count that means nothing at zero and means something above it. */
function Trouble({ value }: { value: number }) {
  return (
    <span className={cn("figures text-right", value > 0 ? "text-warn" : "text-text-2 opacity-50")}>
      {count(value)}
    </span>
  );
}

function Loading() {
  return (
    <div className="p-3" aria-label="Loading boards">
      {Array.from({ length: 14 }).map((_, index) => (
        <div key={index} className="shimmer mb-2 h-3 rounded-sm bg-hover" />
      ))}
    </div>
  );
}
