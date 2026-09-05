/**
 * The read API, typed.
 *
 * Every shape here matches what `blackboardxray.server.app` answers. A field
 * that the server can answer as null is typed as null, so a screen has to
 * decide what to show instead rather than rendering the word "undefined".
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AgentDeclaration, Outcome, RegionDeclaration, RunEvent } from "./events";

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

export interface Project {
  id: number;
  slug: string;
  name: string;
  created_at: string;
  runs: number;
  keys: number;
}

/** What the platform answered when it could not do what was asked. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function get<T>(path: string): Promise<T> {
  let answer: Response;
  try {
    answer = await fetch(`/api/v1${path}`, {
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ApiError(
      0,
      "unreachable",
      "The platform could not be reached. Check that the server is running."
    );
  }
  if (!answer.ok) {
    let code = "request_failed";
    let detail = `The platform answered ${answer.status}.`;
    try {
      const body = await answer.json();
      code = body.error ?? code;
      detail = body.detail ?? detail;
    } catch {
      // A body that is not JSON leaves the status as the whole story.
    }
    throw new ApiError(answer.status, code, detail);
  }
  return (await answer.json()) as T;
}

function search(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== null) {
      query.set(key, String(value));
    }
  }
  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}

/** An open run is still moving, so its views refetch. A closed one does not. */
const LIVE = 5000;

export function useHealth(): UseQueryResult<Health, ApiError> {
  return useQuery({ queryKey: ["health"], queryFn: () => get<Health>("/health") });
}

export function useOverview(): UseQueryResult<Overview, ApiError> {
  return useQuery({
    queryKey: ["overview"],
    queryFn: () => get<Overview>("/overview"),
    refetchInterval: LIVE,
  });
}

export interface RunFilters {
  outcome?: string;
  agent?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useRuns(
  filters: RunFilters
): UseQueryResult<{ runs: Run[]; total: number; limit: number; offset: number }, ApiError> {
  return useQuery({
    queryKey: ["runs", filters],
    queryFn: () =>
      get<{ runs: Run[]; total: number; limit: number; offset: number }>(
        `/runs${search({ ...filters })}`
      ),
    refetchInterval: LIVE,
  });
}

export function useRun(boardId: string): UseQueryResult<Run, ApiError> {
  return useQuery({
    queryKey: ["run", boardId],
    queryFn: () => get<Run>(`/runs/${encodeURIComponent(boardId)}`),
    refetchInterval: (query) => (query.state.data?.outcome ? false : LIVE),
  });
}

export function useRunEvents(
  boardId: string,
  isOpen: boolean
): UseQueryResult<{ events: RunEvent[]; has_more: boolean; next_after: number }, ApiError> {
  return useQuery({
    queryKey: ["events", boardId],
    queryFn: () =>
      get<{ events: RunEvent[]; has_more: boolean; next_after: number }>(
        `/runs/${encodeURIComponent(boardId)}/events${search({ limit: 2000 })}`
      ),
    refetchInterval: isOpen ? LIVE : false,
  });
}

export function useAgents(): UseQueryResult<{ agents: AgentSummary[] }, ApiError> {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => get<{ agents: AgentSummary[] }>("/agents"),
    refetchInterval: LIVE,
  });
}

export function useAgent(name: string): UseQueryResult<AgentDetail, ApiError> {
  return useQuery({
    queryKey: ["agent", name],
    queryFn: () => get<AgentDetail>(`/agents/${encodeURIComponent(name)}`),
  });
}

export function useProjects(): UseQueryResult<{ projects: Project[] }, ApiError> {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => get<{ projects: Project[] }>("/projects"),
  });
}

export type { AgentDeclaration, RegionDeclaration, RunEvent };
