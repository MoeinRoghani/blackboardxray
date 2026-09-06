/**
 * The index: the shape of the traffic, then the record of it.
 *
 * One question at a time, top to bottom. The chart says whether the last day
 * looks normal. The facet strip says what it is made of and narrows it. The
 * table is the record itself. Selecting a board opens a panel beside the
 * table rather than a screen after it, so a reader compares a run against the
 * list it came from instead of remembering it.
 *
 * There is no separate overview. An overview is what you build when the list
 * cannot answer anything on its own; a chart and a facet strip welded to the
 * top of the list mean it can.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Facets } from "@/components/Facets";
import { Frame } from "@/components/Frame";
import { Histogram, type Range } from "@/components/Histogram";
import { BoardTable } from "@/components/BoardTable";
import { Inspector } from "@/components/Inspector";
import { cn } from "@/lib/cn";
import { useFacets, useHistogram, useRunPages, useSettled } from "@/lib/api";
import { WINDOWS, useQueryState } from "@/lib/query";

export function Boards() {
  const query = useQueryState();
  const histogram = useHistogram(query.span, query.filters);
  const facets = useFacets(query.filters);
  const pages = useRunPages(query.filters);

  const runs = useMemo(
    () => pages.data?.pages.flatMap((page) => page.runs) ?? [],
    [pages.data]
  );
  const total = pages.data?.pages[0]?.total ?? 0;

  const range: Range | null =
    query.since && query.until ? { since: query.since, until: query.until } : null;

  const onRange = useCallback(
    (next: Range | null) => query.set({ since: next?.since ?? null, until: next?.until ?? null }),
    [query]
  );

  const onEnd = useCallback(() => {
    if (pages.hasNextPage && !pages.isFetchingNextPage) void pages.fetchNextPage();
  }, [pages]);

  return (
    <Frame
      search={<SearchField value={query.term} onChange={(term) => query.set({ term })} />}
      window={<WindowPicker value={query.window} onChange={(window) => query.set({ window })} />}
    >
      <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
        <Histogram
          data={histogram.data}
          loading={histogram.isLoading}
          range={range}
          onRange={onRange}
        />

        <Facets
          data={facets.data}
          outcome={query.outcome}
          unfinished={query.unfinished}
          agent={query.agent}
          narrowed={query.narrowed}
          ranged={range ? rangeLabel(range) : null}
          onOutcome={query.toggleOutcome}
          onUnfinished={() => query.set({ unfinished: !query.unfinished })}
          onAgent={(agent) => query.set({ agent })}
          onClearRange={() => onRange(null)}
          onClear={query.clear}
        />

        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto]">
          <div
            className={cn(
              "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)]",
              query.board && "max-lg:hidden"
            )}
          >
            <BoardTable
              runs={runs}
              total={total}
              selected={query.board}
              loading={pages.isLoading}
              hasMore={Boolean(pages.hasNextPage)}
              fetching={pages.isFetchingNextPage}
              onSelect={(board) => query.set({ board: board === query.board ? null : board })}
              onEnd={onEnd}
            />
          </div>
          {query.board ? (
            <Inspector boardId={query.board} onClose={() => query.set({ board: null })} />
          ) : null}
        </div>
      </div>
    </Frame>
  );
}

function rangeLabel(range: Range): string {
  const from = new Date(range.since);
  const to = new Date(range.until);
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${time(from)}–${time(to)}`;
}

/**
 * Search is in the bar rather than over the table, because it narrows the
 * chart as well. A control that changes two regions belongs above both.
 */
function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  // A keystroke is not a query. The field keeps its own draft and the settled
  // value is what reaches the server, so typing eight characters is one
  // request rather than eight.
  const [draft, setDraft] = useState(value);
  const settled = useSettled(draft);

  useEffect(() => {
    if (settled !== value) onChange(settled);
    // The callback is rebuilt on every render of the parent. Depending on it
    // would fire this effect on every render and push the draft back over a
    // value the reader is still typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  // A value that changed elsewhere, such as the clear control, has to reach
  // the field. A value this field itself just sent must not bounce back.
  useEffect(() => {
    setDraft((current) => (current === value || current === settled ? current : value));
  }, [value, settled]);

  return (
    <div className="relative flex w-full max-w-sm items-center">
      <Search size={13} aria-hidden className="pointer-events-none absolute left-2 text-text-2" />
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Filter boards by name"
        aria-label="Filter boards by name"
        className="h-7 w-full rounded-sm border border-edge bg-plane pr-2 pl-7 type-caption text-text placeholder:text-text-2"
      />
    </div>
  );
}

function WindowPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: (typeof WINDOWS)[number]["id"]) => void;
}) {
  return (
    <div className="flex items-center rounded-sm border border-edge bg-plane p-1" role="group" aria-label="Time window">
      {WINDOWS.map((window) => (
        <button
          key={window.id}
          type="button"
          onClick={() => onChange(window.id)}
          aria-pressed={value === window.id}
          className={cn(
            "move-state rounded-sm px-1.5 type-caption",
            value === window.id ? "bg-active text-text" : "text-text-2 hover:text-text"
          )}
        >
          {window.id}
        </button>
      ))}
    </div>
  );
}
