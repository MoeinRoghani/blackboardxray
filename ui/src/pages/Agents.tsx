/**
 * Which agent misbehaves, across every run.
 *
 * An agent is not registered with this platform. It is observed, so it appears
 * here the moment it writes or is notified in any run, and its record spans
 * every run it took part in.
 *
 * Agents deliberately carry no colour. There is no bounded set of them, so a
 * palette would run out and start repeating, and a repeated hue reads as a
 * relationship that is not there.
 */
import { Boxes } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge, LiveDot } from "@/components/Badge";
import { PageHeader } from "@/components/PageHeader";
import { RowSkeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import { useAgent, useAgents, type AgentSummary } from "@/lib/api";
import { cn } from "@/lib/cn";
import { OUTCOME_LABEL, OUTCOME_TONE } from "@/lib/events";
import { ago, count, duration } from "@/lib/format";

export function Agents() {
  const agents = useAgents();

  return (
    <>
      <PageHeader
        title="Agents"
        meta={
          agents.data ? (
            <span className="numeric">
              {count(agents.data.agents.length)} seen
            </span>
          ) : null
        }
      />

      {agents.isError ? <ErrorState error={agents.error} /> : null}

      {agents.isLoading ? (
        <div className="rounded-md border border-border-subtle">
          {Array.from({ length: 5 }, (_, index) => (
            <RowSkeleton key={index} columns={5} />
          ))}
        </div>
      ) : null}

      {agents.data && agents.data.agents.length === 0 ? (
        <EmptyState icon={Boxes} title="No agent has been seen yet">
          An agent appears here once it has written to a board or been notified
          of a change in any observed run.
        </EmptyState>
      ) : null}

      {agents.data && agents.data.agents.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full min-w-3xl border-collapse">
            <thead>
              <tr className="border-b border-border-subtle bg-surface-sunken">
                <th scope="col" className="type-label px-3 py-2 text-left font-medium text-text-secondary">
                  Agent
                </th>
                <Th>Runs</Th>
                <Th>Writes</Th>
                <Th>Refused</Th>
                <Th>Notified</Th>
                <Th>Acked</Th>
                <Th>Never delivered</Th>
                <Th>Median answer</Th>
                <Th>Left unfinished</Th>
                <Th align="right">Last seen</Th>
              </tr>
            </thead>
            <tbody>
              {agents.data.agents.map((agent) => (
                <AgentRow key={agent.agent} agent={agent} />
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

function AgentRow({ agent }: { agent: AgentSummary }) {
  const owing = agent.dispatched - agent.acked;
  return (
    <tr className="border-b border-border-subtle last:border-b-0 hover:bg-surface-hover">
      <td className="px-3 py-2">
        <Link
          to={`/agents/${encodeURIComponent(agent.agent)}`}
          className="type-small font-medium text-text-primary hover:text-brand-text"
        >
          {agent.agent}
        </Link>
      </td>
      <Num>{agent.runs}</Num>
      <Num>{agent.writes + agent.premise_sets}</Num>
      <Num tone={agent.refusals ? "expired" : undefined}>{agent.refusals}</Num>
      <Num>{agent.dispatched}</Num>
      <Num tone={owing > 0 ? "expired" : undefined}>{agent.acked}</Num>
      <Num tone={agent.failed ? "aborted" : undefined}>{agent.failed}</Num>
      <td className="numeric whitespace-nowrap px-3 py-2 text-right type-small text-text-primary">
        {agent.median_response === null ? (
          <span className="text-text-secondary">never answered</span>
        ) : (
          duration(agent.median_response)
        )}
      </td>
      <Num tone={agent.unfinished_in ? "aborted" : undefined}>
        {agent.unfinished_in}
      </Num>
      <td className="whitespace-nowrap px-3 py-2 text-right type-caption text-text-secondary">
        {ago(agent.last_seen)}
      </td>
    </tr>
  );
}

function Num({
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

export function AgentDetail() {
  const { name = "" } = useParams();
  const agent = useAgent(name);

  if (agent.isError) return <ErrorState error={agent.error} />;
  if (agent.isLoading || !agent.data) {
    return (
      <div className="rounded-md border border-border-subtle">
        {Array.from({ length: 4 }, (_, index) => (
          <RowSkeleton key={index} columns={3} />
        ))}
      </div>
    );
  }

  const data = agent.data;
  const owing = data.dispatched - data.acked;

  return (
    <>
      <PageHeader
        title={data.agent}
        meta={
          <>
            <span className="numeric">{count(data.runs)} runs</span>
            <span className="numeric">
              {count(data.writes + data.premise_sets)} writes
            </span>
            <span className="numeric">
              {data.median_response === null
                ? "never answered a notification"
                : `answers in ${duration(data.median_response)}`}
            </span>
          </>
        }
      />

      {owing > 0 || data.failed > 0 || data.unfinished_in > 0 ? (
        <div className="mb-6 flex flex-col gap-1 rounded-md border border-expired-border bg-expired-bg p-4">
          {owing > 0 ? (
            <p className="type-small text-expired-text">
              {count(owing)} of {count(data.dispatched)} notifications were never
              acknowledged.
            </p>
          ) : null}
          {data.failed > 0 ? (
            <p className="type-small text-expired-text">
              {count(data.failed)} never reached it, so it does not know what it
              was owed.
            </p>
          ) : null}
          {data.unfinished_in > 0 ? (
            <p className="type-small text-expired-text">
              It was named unfinished in {count(data.unfinished_in)}{" "}
              {data.unfinished_in === 1 ? "run" : "runs"}.
            </p>
          ) : null}
        </div>
      ) : null}

      <h2 className="type-heading pb-3 text-text-primary">Runs it took part in</h2>
      <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
        {data.runs_seen.map((run) => (
          <li key={run.board_id}>
            <Link
              to={`/runs/${encodeURIComponent(run.board_id)}`}
              className="flex flex-wrap items-baseline gap-3 p-3 hover:bg-surface-hover"
            >
              <span className="numeric min-w-0 flex-1 truncate type-small text-text-primary">
                {run.board_id}
              </span>
              {run.unfinished.includes(data.agent) ? (
                <span className="type-caption text-aborted-text">
                  left unfinished here
                </span>
              ) : null}
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
              <span className="type-caption text-text-secondary">
                {ago(run.last_event_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
