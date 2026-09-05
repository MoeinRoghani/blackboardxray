/**
 * Every run, newest activity first.
 *
 * A table rather than cards. At this density a card around each row is six
 * borders and a shadow doing the work one hairline already did, and a reader
 * comparing two runs needs the numbers in the same column, which cards break.
 */
import { ListTree, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, LiveDot } from "@/components/Badge";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { RowSkeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import { useRuns, type Run } from "@/lib/api";
import { cn } from "@/lib/cn";
import { OUTCOME_LABEL, OUTCOME_TONE } from "@/lib/events";
import { ago, count, duration } from "@/lib/format";

const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "settled", label: "Settled" },
  { value: "wall_clock_expired", label: "Expired" },
  { value: "aborted", label: "Aborted" },
];

export function Runs() {
  const [params, setParams] = useSearchParams();
  const outcome = params.get("outcome") ?? "";
  const agent = params.get("agent") ?? "";
  const [search, setSearch] = useState(params.get("search") ?? "");

  const filters = useMemo(
    () => ({
      outcome: outcome || undefined,
      agent: agent || undefined,
      search: params.get("search") || undefined,
      limit: 100,
    }),
    [outcome, agent, params]
  );
  const runs = useRuns(filters);

  function apply(next: Record<string, string>) {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) merged.set(key, value);
      else merged.delete(key);
    }
    setParams(merged, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Runs"
        meta={
          runs.data ? (
            <span className="numeric">
              {count(runs.data.total)} {runs.data.total === 1 ? "run" : "runs"}
              {agent ? ` involving ${agent}` : ""}
            </span>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2 pb-4">
        <div className="flex items-center gap-1 rounded-sm border border-border-default bg-surface-raised p-0.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => apply({ outcome: filter.value })}
              className={cn(
                "rounded-sm px-2 py-1 type-caption transition-colors duration-fast ease-standard",
                outcome === filter.value
                  ? "bg-surface-active font-medium text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(submitted) => {
            submitted.preventDefault();
            apply({ search });
          }}
        >
          <div className="flex items-center gap-2 rounded-sm border border-border-default bg-surface-raised px-2">
            <Search aria-hidden className="size-3.5 text-text-secondary" />
            <input
              value={search}
              onChange={(changed) => setSearch(changed.target.value)}
              placeholder="Board identifier"
              aria-label="Search by board identifier"
              className="numeric h-7 w-48 bg-transparent type-caption text-text-primary placeholder:text-text-secondary focus:outline-none"
            />
          </div>
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>

        {agent ? (
          <Button size="sm" emphasis="ghost" onClick={() => apply({ agent: "" })}>
            Clear agent filter
          </Button>
        ) : null}
      </div>

      {runs.isError ? <ErrorState error={runs.error} /> : null}

      {runs.isLoading ? (
        <div className="rounded-md border border-border-subtle">
          {Array.from({ length: 6 }, (_, index) => (
            <RowSkeleton key={index} columns={5} />
          ))}
        </div>
      ) : null}

      {runs.data && runs.data.runs.length === 0 ? (
        <EmptyState
          icon={ListTree}
          title={
            outcome || agent || filters.search
              ? "No run matches this filter"
              : "No run has been observed yet"
          }
          command={
            outcome || agent || filters.search
              ? undefined
              : `from blackboardxray import Xray\n\nxray = Xray(endpoint="http://localhost:8900", token="bxr_...")\nmodel = xray.create_model(board_id="incident-1", store=store, regions=..., premises=..., limits=...)`
          }
        >
          {outcome || agent || filters.search ? (
            <>Clear the filter to see every run this project has sent.</>
          ) : (
            <>
              A run appears here the moment an application creates one through
              `Xray.create_model`. Every argument is the one
              `blackboard.create_model` takes.
            </>
          )}
        </EmptyState>
      ) : null}

      {runs.data && runs.data.runs.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full min-w-3xl border-collapse">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-sunken">
                <Th align="left">Board</Th>
                <Th align="left">Outcome</Th>
                <Th>Seq</Th>
                <Th>Writes</Th>
                <Th>Refused</Th>
                <Th>Notified</Th>
                <Th>Acked</Th>
                <Th>Failed</Th>
                <Th align="left">Agents</Th>
                <Th align="right">Activity</Th>
              </tr>
            </thead>
            <tbody>
              {runs.data.runs.map((run) => (
                <RunRow key={run.board_id} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function Th({
  children,
  align = "right",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "type-label whitespace-nowrap px-3 py-2 font-medium text-text-secondary",
        align === "left" ? "text-left" : "text-right"
      )}
    >
      {children}
    </th>
  );
}

function RunRow({ run }: { run: Run }) {
  const isOpen = run.outcome === null;
  return (
    <tr className="group border-b border-border-subtle last:border-b-0 hover:bg-surface-hover">
      <td className="px-3 py-2">
        <Link
          to={`/runs/${encodeURIComponent(run.board_id)}`}
          className="numeric type-small font-medium text-text-primary hover:text-brand-text"
        >
          {run.board_id}
        </Link>
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col items-start gap-1">
          {isOpen ? (
            <Badge tone="open">
              <LiveDot />
              Open
            </Badge>
          ) : (
            <Badge tone={OUTCOME_TONE[run.outcome!]}>
              {OUTCOME_LABEL[run.outcome!]}
            </Badge>
          )}
          {run.unfinished.length ? (
            <span className="type-caption text-aborted-text">
              {run.unfinished.join(", ")} unfinished
            </span>
          ) : null}
        </div>
      </td>
      <Cell>{run.last_sequence}</Cell>
      <Cell>{run.n_writes + run.n_premise_sets}</Cell>
      <Cell tone={run.n_refusals ? "expired" : undefined}>{run.n_refusals}</Cell>
      <Cell>{run.n_dispatched}</Cell>
      {/* Acknowledgment is cumulative: answering the widest range answers every
          narrower one it covers, so fewer acknowledgments than notifications is
          the ordinary case and not a fault. Flagging it here would put an amber
          number on almost every healthy run. */}
      <Cell>{run.n_acked}</Cell>
      <Cell tone={run.n_failed ? "aborted" : undefined}>{run.n_failed}</Cell>
      <td className="max-w-48 truncate px-3 py-2 type-caption text-text-secondary">
        {run.agents.join(", ") || "none"}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right type-caption text-text-secondary">
        <span title={run.last_event_at}>{ago(run.last_event_at)}</span>
        {run.opened_at && run.closed_at ? (
          <span className="numeric ml-2 text-text-secondary">
            {duration((Date.parse(run.closed_at) - Date.parse(run.opened_at)) / 1000)}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function Cell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "expired" | "aborted";
}) {
  return (
    <td
      className={cn(
        "numeric px-3 py-2 text-right type-small",
        tone === "expired" && "text-expired-text",
        tone === "aborted" && "font-medium text-aborted-text",
        !tone && "text-text-primary"
      )}
    >
      {count(Number(children))}
    </td>
  );
}
