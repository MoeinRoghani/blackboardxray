/**
 * Is anything wrong.
 *
 * The page answers that in its first screen and then gets out of the way. What
 * needs attention comes before what merely happened, because a healthy fleet
 * should make this page boring.
 */
import { Activity, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, LiveDot } from "@/components/Badge";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { RowSkeleton, Skeleton } from "@/components/Skeleton";
import { Stat, StatRail } from "@/components/Stat";
import { EmptyState, ErrorState } from "@/components/States";
import { useOverview } from "@/lib/api";
import { OUTCOME_LABEL, OUTCOME_TONE } from "@/lib/events";
import { ago, count, duration } from "@/lib/format";

export function Overview() {
  const overview = useOverview();

  if (overview.isError) {
    return (
      <>
        <PageHeader title="Overview" />
        <ErrorState error={overview.error} />
      </>
    );
  }

  if (overview.isLoading || !overview.data) {
    return (
      <>
        <PageHeader title="Overview" />
        <div className="flex gap-8 pb-6">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-20" />
          ))}
        </div>
        <div className="rounded-md border border-border-subtle">
          {Array.from({ length: 5 }, (_, index) => (
            <RowSkeleton key={index} columns={3} />
          ))}
        </div>
      </>
    );
  }

  const data = overview.data;
  const attention = data.recent.filter(
    (run) => run.unfinished.length > 0 || run.n_failed > 0
  );

  if (data.runs === 0) {
    return (
      <>
        <PageHeader title="Overview" meta={<span>Project {data.project}</span>} />
        <EmptyState
          icon={Activity}
          title="Nothing has been observed yet"
          command={`export BLACKBOARDXRAY_ENDPOINT=http://localhost:8900\nexport BLACKBOARDXRAY_TOKEN=bxr_...\n\nfrom blackboardxray import Xray\nxray = Xray.from_env()\nmodel = xray.create_model(board_id=..., store=..., regions=..., premises=..., limits=...)`}
        >
          Point an application at this endpoint with a token and the runs it
          opens appear here. The library is not modified: `Xray.create_model`
          takes the arguments `blackboard.create_model` takes and returns the
          model it returns.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Overview"
        meta={
          <>
            <span>Project {data.project}</span>
            <span className="numeric">{count(data.runs)} runs observed</span>
          </>
        }
        actions={
          <Button emphasis="secondary" size="sm" asChild>
            <Link to="/runs">
              All runs
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </Button>
        }
      />

      <StatRail>
        <Stat label="Open" value={data.open} tone="open" to="/runs?outcome=open" />
        <Stat
          label="Settled"
          value={data.settled}
          tone="settled"
          to="/runs?outcome=settled"
        />
        <Stat
          label="Expired"
          value={data.expired}
          tone="expired"
          to="/runs?outcome=wall_clock_expired"
        />
        <Stat
          label="Aborted"
          value={data.aborted}
          tone="aborted"
          to="/runs?outcome=aborted"
        />
        <Stat label="On the board" value={data.writes} hint="writes admitted" />
        <Stat
          label="Refused"
          value={data.refusals}
          tone={data.refusals ? "expired" : "neutral"}
          hint="by an admission rule"
        />
        <Stat
          label="Never delivered"
          value={data.failed}
          tone={data.failed ? "aborted" : "neutral"}
          hint="the agent never heard"
        />
      </StatRail>

      <section className="pt-6">
        <h2 className="type-heading pb-3 text-text-primary">Needs attention</h2>
        {attention.length === 0 ? (
          <p className="rounded-md border border-border-subtle bg-surface-raised p-4 type-small text-text-secondary">
            No recent run left an agent unfinished and no notification failed to
            arrive. {data.with_unfinished > 0 ? (
              <>
                {count(data.with_unfinished)} older{" "}
                {data.with_unfinished === 1 ? "run" : "runs"} did.{" "}
                <Link className="text-brand-text hover:underline" to="/runs">
                  Open the full list
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {attention.map((run) => (
              <li key={run.board_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
                <Link
                  to={`/runs/${encodeURIComponent(run.board_id)}`}
                  className="numeric type-small font-medium text-text-primary hover:text-brand-text"
                >
                  {run.board_id}
                </Link>
                {run.outcome ? (
                  <Badge tone={OUTCOME_TONE[run.outcome]}>
                    {OUTCOME_LABEL[run.outcome]}
                  </Badge>
                ) : (
                  <Badge tone="open">
                    <LiveDot />
                    Open
                  </Badge>
                )}
                {run.unfinished.length ? (
                  <span className="type-caption text-expired-text">
                    unfinished: {run.unfinished.join(", ")}
                  </span>
                ) : null}
                {run.n_failed ? (
                  <span className="numeric type-caption text-aborted-text">
                    {count(run.n_failed)} never delivered
                  </span>
                ) : null}
                <span className="ml-auto type-caption text-text-secondary">
                  {ago(run.last_event_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 pt-8 lg:grid-cols-2">
        <section>
          <h2 className="type-heading pb-3 text-text-primary">Recent runs</h2>
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {data.recent.map((run) => (
              <li key={run.board_id}>
                <Link
                  to={`/runs/${encodeURIComponent(run.board_id)}`}
                  className="flex items-baseline gap-3 p-3 hover:bg-surface-hover"
                >
                  <span className="numeric min-w-0 flex-1 truncate type-small text-text-primary">
                    {run.board_id}
                  </span>
                  <span className="numeric type-caption text-text-secondary">
                    {count(run.last_sequence)} seq
                  </span>
                  {run.outcome ? (
                    <Badge tone={OUTCOME_TONE[run.outcome]}>
                      {OUTCOME_LABEL[run.outcome]}
                    </Badge>
                  ) : (
                    <Badge tone="open">
                      <LiveDot />
                      Open
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="type-heading pb-3 text-text-primary">Busiest agents</h2>
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {data.busiest_agents.map((agent) => (
              <li key={agent.agent}>
                <Link
                  to={`/agents/${encodeURIComponent(agent.agent)}`}
                  className="flex items-baseline gap-3 p-3 hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1 truncate type-small text-text-primary">
                    {agent.agent}
                  </span>
                  <span className="numeric type-caption text-text-secondary">
                    {count(agent.writes)} writes
                  </span>
                  <span className="numeric type-caption text-text-secondary">
                    {agent.median_response === null
                      ? "never answered"
                      : duration(agent.median_response)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
