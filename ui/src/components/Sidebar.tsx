/**
 * The navigation column, and everything that acts on it.
 *
 * Search and the outcome filters sit here rather than in the global bar,
 * directly above the rows they change. Proximity is the grouping signal that
 * outranks every other, and a control 800px from its content has none of it.
 *
 * Overview is a row in this column rather than a destination elsewhere: the
 * overview is runs counted, so it belongs at the top of the runs column, which
 * is where the operator is already looking.
 */
import { LayoutDashboard, ListTree, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { RunState } from "@/components/State";
import { RowSkeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import type { ApiError, Run } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ago, count } from "@/lib/format";

const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "settled", label: "Settled" },
  { value: "wall_clock_expired", label: "Expired" },
  { value: "aborted", label: "Aborted" },
];

export function Sidebar({
  runs,
  selected,
  onOverview,
  atOverview,
  needsAttention,
  loading,
  error,
  outcome,
  onOutcome,
  term,
  onTerm,
  onSelect,
}: {
  runs: Run[];
  selected: string | null;
  onOverview: () => void;
  atOverview: boolean;
  needsAttention: number;
  loading: boolean;
  error: ApiError | null;
  outcome: string;
  onOutcome: (value: string) => void;
  term: string;
  onTerm: (value: string) => void;
  onSelect: (boardId: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (!runs.length) return;
      event.preventDefault();
      const at = runs.findIndex((run) => run.board_id === selected);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = at === -1 ? 0 : Math.min(runs.length - 1, Math.max(0, at + step));
      onSelect(runs[next].board_id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runs, selected, onSelect]);

  useEffect(() => {
    list.current
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      {/* A real input, not a button dressed as one. The old control looked
          like a field and threw a dialog when you clicked into it, and it was
          hidden below the small breakpoint, which left the product with no
          search at all on a phone. */}
      <div className="shrink-0 border-b border-hairline p-3">
        <div className="flex h-8 items-center gap-2 rounded-sm border border-edge bg-canvas px-2 focus-within:border-focus">
          <Search aria-hidden className="size-3.5 shrink-0 text-text-2" />
          <input
            value={term}
            onChange={(event) => onTerm(event.target.value)}
            placeholder="Filter by board"
            aria-label="Filter runs by board identifier"
            className="code w-full min-w-0 bg-transparent text-text outline-none"
          />
          {term ? (
            <button
              type="button"
              onClick={() => onTerm("")}
              aria-label="Clear the filter"
              className="move-state shrink-0 rounded-sm p-0.5 text-text-2 hover:text-text"
            >
              <X aria-hidden className="size-3" />
            </button>
          ) : null}
        </div>

        <div
          role="tablist"
          aria-label="Filter runs by outcome"
          className="flex flex-wrap items-center gap-1 pt-2"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              role="tab"
              aria-selected={outcome === filter.value}
              onClick={() => onOutcome(filter.value)}
              className={cn(
                "move-state rounded-sm px-1.5 py-0.5 type-caption",
                outcome === filter.value
                  ? "bg-active font-medium text-text"
                  : "text-text-2 hover:bg-hover hover:text-text"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <nav className="shrink-0 border-b border-hairline p-1.5">
        <button
          type="button"
          onClick={onOverview}
          aria-current={atOverview}
          className={cn(
            "move-state flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left type-small",
            atOverview
              ? "bg-active font-medium text-text"
              : "text-text-2 hover:bg-hover hover:text-text"
          )}
        >
          <LayoutDashboard aria-hidden className="size-3.5 shrink-0" />
          Overview
          {needsAttention > 0 ? (
            <span className="figures ml-auto rounded-sm bg-bad-wash px-1.5 py-0.5 type-caption text-bad">
              {count(needsAttention)}
            </span>
          ) : null}
        </button>
      </nav>

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex items-baseline justify-between px-3 pb-1.5 pt-3">
          <span className="type-label">Runs</span>
          {!loading && !error ? (
            <span className="figures type-caption text-text-2">{count(runs.length)}</span>
          ) : null}
        </div>

        {error ? <ErrorState error={error} className="m-3" /> : null}
        {loading ? Array.from({ length: 7 }, (_, i) => <RowSkeleton key={i} />) : null}

        {!loading && !error && runs.length === 0 ? (
          <EmptyState
            icon={ListTree}
            title={outcome || term ? "No run matches" : "No run yet"}
            className="m-3"
          >
            {outcome || term
              ? "Clear the filter above to see every run."
              : "A run appears the moment an application creates one."}
          </EmptyState>
        ) : null}

        {runs.map((run) => (
          <button
            key={run.board_id}
            type="button"
            aria-current={run.board_id === selected}
            onClick={() => onSelect(run.board_id)}
            className={cn(
              "move-state relative block w-full border-b border-hairline px-3 py-2.5 text-left",
              run.board_id === selected
                ? "bg-live-wash before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-live-solid before:content-['']"
                : "hover:bg-hover"
            )}
          >
            <span className="flex items-baseline gap-2">
              <span className="code truncate font-medium text-text">{run.board_id}</span>
              <span className="ml-auto shrink-0 type-caption text-text-2">
                {ago(run.last_event_at)}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
              <RunState outcome={run.outcome} />
              <span className="figures type-caption text-text-2">
                {count(run.last_sequence)} on board
              </span>
            </span>
            {run.unfinished.length || run.n_failed ? (
              <span className="block pt-1 type-caption text-bad">
                {run.unfinished.length ? `${run.unfinished.join(", ")} did not finish` : null}
                {run.unfinished.length && run.n_failed ? " · " : null}
                {run.n_failed ? `${count(run.n_failed)} never delivered` : null}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
