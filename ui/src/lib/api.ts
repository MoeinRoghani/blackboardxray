/**
 * The read API, typed.
 *
 * Every shape here matches what `blackboardxray.server.app` answers. A field
 * that the server can answer as null is typed as null, so a screen has to
 * decide what to show instead rather than rendering the word "undefined".
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { AgentDeclaration, Outcome, RegionDeclaration, RunEvent } from "./events";
import { ApiError, get, search } from "./http";

export { ApiError };

/**
 * The project every read below is about, taken from the address.
 *
 * A project used to be implicit, because there was one. It is in the path now,
 * so a hook reads it rather than every call site threading it through: the
 * screens did not need to learn about tenancy, only the layer under them did.
 */
export function useProjectId(): string {
  const { projectId = "" } = useParams();
  return projectId;
}

export interface Run {
  project_id: number;
  board_id: string;
  opened_at: string | null;
  closed_at: string | null;
  outcome: Outcome | null;
  reason: string | null;
  unfinished: string[];
  regions: RegionDeclaration[];
  limits: { wall_clock_seconds?: number; idle_seconds?: number };
  store: string | null;
  first_seen_at: string;
  last_event_at: string;
  last_sequence: number;
  n_events: number;
  n_writes: number;
  n_premise_sets: number;
  n_refusals: number;
  n_conflicts: number;
  n_dispatched: number;
  n_acked: number;
  n_failed: number;
  agents: string[];
}

export interface AgentSummary {
  agent: string;
  runs: number;
  writes: number;
  premise_sets: number;
  refusals: number;
  conflicts: number;
  dispatched: number;
  acked: number;
  failed: number;
  last_seen: string | null;
  median_response: number | null;
  unfinished_in: number;
}

export interface AgentDetail extends AgentSummary {
  runs_seen: Run[];
  /** From the agent's most recent registration, which replaced any earlier one. */
  subscribes_to: string[] | null;
  writes_to: string[] | null;
}

export interface Overview {
  project: string;
  runs: number;
  open: number;
  settled: number;
  expired: number;
  aborted: number;
  with_unfinished: number;
  writes: number;
  refusals: number;
  conflicts: number;
  dispatched: number;
  acked: number;
  failed: number;
  recent: Run[];
  busiest_agents: AgentSummary[];
}

export interface Health {
  status: string;
  schema_version: number;
  kinds: string[];
}

/** An open run is still moving, so its views refetch. A closed one does not. */
const LIVE = 5000;

export function useHealth(): UseQueryResult<Health, ApiError> {
  return useQuery({ queryKey: ["health"], queryFn: () => get<Health>("/health") });
}

export function useOverview(): UseQueryResult<Overview, ApiError> {
  const project = useProjectId();
  return useQuery({
    queryKey: ["overview", project],
    queryFn: () => get<Overview>(`/projects/${project}/overview`),
    refetchInterval: LIVE,
  });
}

export interface RunFilters {
  outcome?: string;
  agent?: string;
  search?: string;
  unfinished?: boolean;
  /** The half open interval a chart bar selects. */
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/** One interval of the index chart. Absent intervals arrive as zeroes. */
export interface Bucket {
  at: string;
  open: number;
  settled: number;
  aborted: number;
  expired: number;
}

export interface Histogram {
  step_seconds: number;
  from: string;
  to: string;
  buckets: Bucket[];
}

/**
 * How many runs each choice would leave.
 *
 * Taken with every filter applied except the one being counted, so a count
 * answers "what is over there" rather than "what is already selected".
 */
export interface Facets {
  total: number;
  open: number;
  settled: number;
  aborted: number;
  expired: number;
  unfinished: number;
  refusals: number;
  conflicts: number;
  failed: number;
  writes: number;
  agents: { name: string; runs: number }[];
}

export interface Window {
  step: number;
  buckets: number;
}

export function useHistogram(
  window: Window,
  filters: RunFilters
): UseQueryResult<Histogram, ApiError> {
  const project = useProjectId();
  return useQuery({
    queryKey: ["histogram", project, window, filters],
    queryFn: () =>
      get<Histogram>(`/projects/${project}/histogram${search({
          step: window.step,
          buckets: window.buckets,
          agent: filters.agent,
          search: filters.search,
        })}`
      ),
    refetchInterval: LIVE,
    placeholderData: (previous) => previous,
  });
}

export function useFacets(filters: RunFilters): UseQueryResult<Facets, ApiError> {
  const project = useProjectId();
  return useQuery({
    queryKey: [
      "facets",
      project,
      filters.agent,
      filters.search,
      filters.since,
      filters.until,
    ],
    queryFn: () =>
      get<Facets>(`/projects/${project}/facets${search({
          agent: filters.agent,
          search: filters.search,
          since: filters.since,
          until: filters.until,
        })}`
      ),
    refetchInterval: LIVE,
    placeholderData: (previous) => previous,
  });
}

/** How many rows one request carries. The table virtualises, so this is about
 *  how often it goes back to the server and not about what it can draw. */
const PAGE = 200;

export interface RunPage {
  runs: Run[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * The table's rows, a page at a time.
 *
 * A project holds thousands of runs, so the list is never fetched whole. The
 * table asks for the next page when the reader nears the end of what it has,
 * which is the only reason the count of loaded rows and the total differ.
 */
export function useRunPages(
  filters: RunFilters
): UseInfiniteQueryResult<{ pages: RunPage[]; pageParams: number[] }, ApiError> {
  const project = useProjectId();
  return useInfiniteQuery({
    queryKey: ["run-pages", project, filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      get<RunPage>(`/projects/${project}/runs${search({
          ...filters,
          unfinished: filters.unfinished ? 1 : undefined,
          limit: PAGE,
          offset: pageParam as number,
        })}`
      ),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((sum, page) => sum + page.runs.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    refetchInterval: LIVE,
    placeholderData: (previous) => previous,
  });
}

export function useRun(boardId: string): UseQueryResult<Run, ApiError> {
  const project = useProjectId();
  return useQuery({
    queryKey: ["run", project, boardId],
    queryFn: () => get<Run>(`/projects/${project}/runs/${encodeURIComponent(boardId)}`),
    refetchInterval: (query) => (query.state.data?.outcome ? false : LIVE),
  });
}

export function useRunEvents(
  boardId: string,
  isOpen: boolean
): UseQueryResult<{ events: RunEvent[]; has_more: boolean; next_after: number }, ApiError> {
  const project = useProjectId();
  return useQuery({
    queryKey: ["events", project, boardId],
    queryFn: () =>
      get<{ events: RunEvent[]; has_more: boolean; next_after: number }>(`/projects/${project}/runs/${encodeURIComponent(boardId)}/events${search({ limit: 2000 })}`
      ),
    refetchInterval: isOpen ? LIVE : false,
  });
}

export function useAgents(): UseQueryResult<{ agents: AgentSummary[] }, ApiError> {
  const project = useProjectId();
  return useQuery({
    queryKey: ["agents", project],
    queryFn: () => get<{ agents: AgentSummary[] }>(`/projects/${project}/agents`),
    refetchInterval: LIVE,
  });
}

export function useAgent(name: string): UseQueryResult<AgentDetail, ApiError> {
  const project = useProjectId();
  return useQuery({
    queryKey: ["agent", project, name],
    queryFn: () => get<AgentDetail>(`/projects/${project}/agents/${encodeURIComponent(name)}`),
  });
}


export type { AgentDeclaration, RegionDeclaration, RunEvent };

/**
 * A value that settles before anything acts on it.
 *
 * Typing eight characters into the run filter fired eight requests, one per
 * keystroke, seven of which were obsolete before they returned.
 */
export function useSettled<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
