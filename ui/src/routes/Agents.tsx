/**
 * The agents, across every run.
 *
 * A board answers what one run did. This answers what one agent does: an agent
 * that is refused on one run has a bad afternoon, and an agent refused on four
 * hundred is misconfigured. The distinction is only visible from here, which
 * is why this is a place and not a filter.
 *
 * Same table as the index, same density, same alignment. Two tables that look
 * different are two things to learn.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Frame } from "@/components/Frame";
import { cn } from "@/lib/cn";
import { ago, count, duration } from "@/lib/format";
import { useAgent, useAgents, useProjectId } from "@/lib/api";

const COLUMNS = "cols-agents";

export function Agents() {
  const agents = useAgents();
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(
    () => [...(agents.data?.agents ?? [])].sort((a, b) => b.writes - a.writes),
    [agents.data]
  );

  return (
    <Frame>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_auto]">
        <div className={cn("plane scroll-end min-h-0 overflow-auto", open && "max-lg:hidden")}>
          <div className="min-w-table">
          <div
            role="row"
            className={cn(
              "sticky top-0 z-20 grid items-center gap-2 border-b border-rule bg-plane-2 px-3 py-1.5 type-label",
              COLUMNS
            )}
          >
            <span>Agent</span>
            <span className="text-right">Runs</span>
            <span className="text-right">Writes</span>
            <span className="text-right">Refused</span>
            <span className="text-right">Conflicts</span>
            <span className="text-right">Acked</span>
            <span className="text-right">Median reply</span>
            <span className="text-right">Last seen</span>
          </div>

          <div>
            {agents.isLoading ? (
              <p className="px-3 py-6 type-small text-text-2">Loading agents.</p>
            ) : null}
            {!agents.isLoading && rows.length === 0 ? (
              <p className="px-3 py-6 type-small text-text-2">
                No agent has registered on any run yet.
              </p>
            ) : null}
            {rows.map((agent) => (
              <div
                key={agent.agent}
                role="row"
                aria-selected={agent.agent === open}
                tabIndex={0}
                onClick={() => setOpen(agent.agent === open ? null : agent.agent)}
                onKeyDown={(keyed) => {
                  if (keyed.key === "Enter" || keyed.key === " ") {
                    keyed.preventDefault();
                    setOpen(agent.agent === open ? null : agent.agent);
                  }
                }}
                className={cn(
                  "row move-state grid h-row cursor-pointer items-center gap-2 px-3 type-caption",
                  COLUMNS
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-text">{agent.agent}</span>
                  {agent.unfinished_in > 0 ? (
                    <AlertTriangle
                      size={11}
                      className="shrink-0 text-warn"
                      aria-label={`did not finish in ${agent.unfinished_in} runs`}
                    />
                  ) : null}
                </span>
                <span className="figures text-right text-text-2">{count(agent.runs)}</span>
                <span className="figures text-right">{count(agent.writes)}</span>
                <span className={cn("figures text-right", agent.refusals ? "text-warn" : "text-text-2 opacity-50")}>
                  {count(agent.refusals)}
                </span>
                <span className={cn("figures text-right", agent.conflicts ? "text-warn" : "text-text-2 opacity-50")}>
                  {count(agent.conflicts)}
                </span>
                <span className={cn("figures text-right", agent.failed ? "text-bad" : "text-text-2")}>
                  {count(agent.acked)}
                  <span className="text-text-2">/{count(agent.dispatched)}</span>
                </span>
                <span className="figures text-right text-text-2">
                  {duration(agent.median_response)}
                </span>
                <span className="figures text-right text-text-2">{ago(agent.last_seen)}</span>
              </div>
            ))}
          </div>
          </div>
        </div>

        {open ? <AgentPanel name={open} onClose={() => setOpen(null)} /> : null}
      </div>
    </Frame>
  );
}

function AgentPanel({ name, onClose }: { name: string; onClose: () => void }) {
  const project = useProjectId();
  const agent = useAgent(name);
  return (
    <aside
      aria-label={`Agent ${name}`}
      className="raised move-panel grid min-h-0 w-inspector shrink-0 grid-rows-[auto_minmax(0,1fr)] max-lg:w-full"
    >
      <header className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate type-small text-text">{name}</h2>
        <button
          type="button"
          onClick={onClose}
          className="move-state flex size-target items-center justify-center rounded-sm type-caption text-text-2 hover:bg-hover hover:text-text"
          aria-label="Close this agent"
        >
          Close
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto">
        {agent.data ? (
          <>
            <dl className="grid grid-cols-2 border-b border-rule">
              <Cell term="Subscribes to" value={agent.data.subscribes_to?.join(", ") || "nothing"} />
              <Cell term="Writes to" value={agent.data.writes_to?.join(", ") || "nothing"} />
            </dl>
            <h3 className="type-label px-3 pt-2 pb-1">Recent runs</h3>
            {agent.data.runs_seen.map((run) => (
              <Link
                key={run.board_id}
                to={`/p/${project}/boards/${encodeURIComponent(run.board_id)}`}
                className="row move-state flex items-center gap-2 px-3 py-1.5 hover:bg-hover"
              >
                <span className="code min-w-0 flex-1 truncate type-caption text-text">
                  {run.board_id}
                </span>
                <span className="shrink-0 type-caption figures text-text-2">
                  {count(run.n_writes)} writes
                </span>
              </Link>
            ))}
          </>
        ) : (
          <p className="p-3 type-caption text-text-2">Loading.</p>
        )}
      </div>
    </aside>
  );
}

function Cell({ term, value }: { term: string; value: string }) {
  return (
    <div className="border-b border-hairline px-3 py-1.5 last:border-b-0 [&:nth-last-child(-n+2)]:border-b-0">
      <dt className="type-label">{term}</dt>
      <dd className="truncate type-caption text-text">{value}</dd>
    </div>
  );
}
