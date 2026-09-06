/**
 * What the index is currently asking, held in the URL and nowhere else.
 *
 * Every filter, the time window and the selected board are search parameters,
 * so a view an operator arrives at is a view they can send to someone else.
 * Holding any of it in component state would make the address bar lie, and an
 * observability tool whose links do not reproduce what the sender saw is a
 * tool people take screenshots of instead.
 */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { RunFilters, Window } from "./api";

/** The four outcomes a run can be in, as the index names them. */
export const OUTCOMES = ["open", "settled", "aborted", "wall_clock_expired"] as const;
export type OutcomeFilter = (typeof OUTCOMES)[number];

/**
 * The spans the chart offers, and the bar each is made of.
 *
 * A window is named by the span it covers rather than by its bucket, because
 * that is the question being asked. The bucket count is what keeps a bar wide
 * enough to aim at with a pointer at every span.
 */
export const WINDOWS = [
  { id: "1h", label: "1 hour", step: 60, buckets: 60 },
  { id: "6h", label: "6 hours", step: 300, buckets: 72 },
  { id: "24h", label: "24 hours", step: 900, buckets: 96 },
  { id: "7d", label: "7 days", step: 7200, buckets: 84 },
] as const;

export type WindowId = (typeof WINDOWS)[number]["id"];

export const DEFAULT_WINDOW: WindowId = "24h";

export interface Query {
  outcome: OutcomeFilter | null;
  agent: string | null;
  term: string;
  unfinished: boolean;
  window: WindowId;
  board: string | null;
  /** The interval a chart bar selects, half open. Both or neither. */
  since: string | null;
  until: string | null;
  /** True when anything narrows the list, which is what a clear control needs. */
  narrowed: boolean;
}

export interface QueryApi extends Query {
  filters: RunFilters;
  span: Window;
  set: (next: Partial<Query>) => void;
  toggleOutcome: (outcome: OutcomeFilter) => void;
  clear: () => void;
}

function readWindow(given: string | null): WindowId {
  return WINDOWS.some((w) => w.id === given) ? (given as WindowId) : DEFAULT_WINDOW;
}

function readOutcome(given: string | null): OutcomeFilter | null {
  return OUTCOMES.includes(given as OutcomeFilter) ? (given as OutcomeFilter) : null;
}

export function useQueryState(): QueryApi {
  const [params, setParams] = useSearchParams();

  const outcome = readOutcome(params.get("outcome"));
  const agent = params.get("agent") || null;
  const term = params.get("q") ?? "";
  const unfinished = params.get("unfinished") === "1";
  const window = readWindow(params.get("window"));
  const board = params.get("board") || null;
  const since = params.get("since") || null;
  const until = params.get("until") || null;

  const set = useCallback(
    (next: Partial<Query>) => {
      setParams(
        (current) => {
          const draft = new URLSearchParams(current);
          const write = (key: string, value: string | null) => {
            if (value) draft.set(key, value);
            else draft.delete(key);
          };
          if ("outcome" in next) write("outcome", next.outcome ?? null);
          if ("agent" in next) write("agent", next.agent ?? null);
          if ("term" in next) write("q", next.term || null);
          if ("unfinished" in next) write("unfinished", next.unfinished ? "1" : null);
          if ("window" in next) write("window", next.window ?? null);
          if ("board" in next) write("board", next.board ?? null);
          if ("since" in next) write("since", next.since ?? null);
          if ("until" in next) write("until", next.until ?? null);
          // Moving the window changes what the bars mean, so an interval
          // picked out of the old one no longer names anything.
          if ("window" in next) {
            draft.delete("since");
            draft.delete("until");
          }
          // Narrowing the list can remove the selected board from it. Keeping
          // the selection would leave a panel describing a run the table no
          // longer shows, which reads as the filter having failed.
          if (
            ("outcome" in next || "agent" in next || "unfinished" in next || "since" in next) &&
            !("board" in next)
          ) {
            draft.delete("board");
          }
          return draft;
        },
        { replace: true }
      );
    },
    [setParams]
  );

  const toggleOutcome = useCallback(
    (next: OutcomeFilter) => set({ outcome: outcome === next ? null : next }),
    [outcome, set]
  );

  const clear = useCallback(
    () => set({ outcome: null, agent: null, term: "", unfinished: false, since: null, until: null }),
    [set]
  );

  const filters = useMemo<RunFilters>(
    () => ({
      outcome: outcome ?? undefined,
      agent: agent ?? undefined,
      search: term || undefined,
      unfinished: unfinished || undefined,
      since: since ?? undefined,
      until: until ?? undefined,
    }),
    [outcome, agent, term, unfinished, since, until]
  );

  const span = useMemo<Window>(() => {
    const found = WINDOWS.find((w) => w.id === window) ?? WINDOWS[2];
    return { step: found.step, buckets: found.buckets };
  }, [window]);

  return {
    outcome,
    agent,
    term,
    unfinished,
    window,
    board,
    since,
    until,
    narrowed: Boolean(outcome || agent || term || unfinished),
    filters,
    span,
    set,
    toggleOutcome,
    clear,
  };
}
