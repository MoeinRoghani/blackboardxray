/**
 * The runs, always present.
 *
 * This column never unmounts and never navigates away. Selecting a run fills
 * the pane beside it, so an operator following a thread keeps the list they
 * were reading, which is the whole reason the menu is gone.
 */
import { useEffect, useRef } from "react";
import { RunState } from "@/components/State";
import { RowSkeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import { ListTree } from "lucide-react";
import type { ApiError, Run } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ago, count } from "@/lib/format";

export function RunList({
  runs,
  selected,
  loading,
  error,
  filtered,
  onSelect,
}: {
  runs: Run[];
  selected: string | null;
  loading: boolean;
  error: ApiError | null;
  filtered: boolean;
  onSelect: (boardId: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);

  // Up and down move the selection, which is what an operator reaches for
  // when a list is the thing they are working through.
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
    <div
      ref={list}
      className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain"
    >
      <div className="flex items-baseline justify-between px-4 pb-2 pt-3">
        <span className="type-label">Runs</span>
        {!loading && !error ? (
          <span className="figures type-caption text-text-2">{count(runs.length)}</span>
        ) : null}
      </div>

      {error ? <ErrorState error={error} className="m-3" /> : null}

      {loading
        ? Array.from({ length: 7 }, (_, index) => <RowSkeleton key={index} />)
        : null}

      {!loading && !error && runs.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title={filtered ? "No run matches" : "No run yet"}
          className="m-3"
        >
          {filtered
            ? "Clear the filter in the header to see every run."
            : "A run appears the moment an application creates one through Xray.create_model."}
        </EmptyState>
      ) : null}

      {runs.map((run) => (
        <button
          key={run.board_id}
          type="button"
          aria-current={run.board_id === selected}
          onClick={() => onSelect(run.board_id)}
          className={cn(
            "move-state relative block w-full border-b border-hairline px-4 py-3 text-left",
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
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5">
            <RunState outcome={run.outcome} />
            <span className="figures type-caption text-text-2">
              {count(run.last_sequence)} on board
            </span>
          </span>
          {run.unfinished.length || run.n_failed ? (
            <span className="block pt-1 type-caption text-bad">
              {run.unfinished.length
                ? `${run.unfinished.join(", ")} did not finish`
                : null}
              {run.unfinished.length && run.n_failed ? " · " : null}
              {run.n_failed ? `${count(run.n_failed)} never delivered` : null}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
