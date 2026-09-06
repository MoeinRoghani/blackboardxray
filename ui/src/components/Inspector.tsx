/**
 * What is going on inside one board.
 *
 * The table says a run refused four writes. This says which agent was refused,
 * from which region, and what the rule said, which is the difference between
 * knowing something is wrong and knowing what to do. It is a panel beside the
 * list rather than a screen after it, so narrowing the list and reading a run
 * are the same activity and the list never has to be found again.
 *
 * Everything here is derived from the run's own events in one request. The
 * board's record says what was written; these say what the run did about it,
 * which is the whole reason this platform exists.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Network, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ago, bytes, between, count, duration, since } from "@/lib/format";
import { OUTCOME_LABEL, runTone, type RunEvent } from "@/lib/events";
import { Dot } from "@/components/Dot";
import { useProjectId, useRun, useRunEvents } from "@/lib/api";

export function Inspector({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const project = useProjectId();
  const run = useRun(boardId);
  const open = run.data ? run.data.outcome === null : false;
  const events = useRunEvents(boardId, open);

  const digest = useMemo(() => summarise(events.data?.events ?? []), [events.data]);

  return (
    <aside
      aria-label={`Board ${boardId}`}
      className="raised move-panel grid min-h-0 w-inspector shrink-0 grid-rows-[auto_minmax(0,1fr)] max-lg:w-full"
    >
      <header className="flex items-start gap-2 border-b border-rule px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Dot tone={runTone(run.data?.outcome ?? null)} big />
            <h2 className="code truncate type-small text-text">{boardId}</h2>
          </div>
          <p className="pt-0.5 type-caption text-text-2">
            {run.data
              ? open
                ? `Open, ${ago(run.data.opened_at)}`
                : `${OUTCOME_LABEL[run.data.outcome!]}${run.data.reason ? `: ${run.data.reason}` : ""}`
              : "Loading"}
          </p>
        </div>
        <Link
          to={`/p/${project}/boards/${encodeURIComponent(boardId)}`}
          className="move-state flex h-6 shrink-0 items-center gap-1 rounded-sm border border-edge bg-plane-2 px-2 type-caption text-text hover:bg-hover"
        >
          <Network size={12} aria-hidden />
          Graph
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close this board"
          className="move-state flex size-target shrink-0 items-center justify-center rounded-sm text-text-2 hover:bg-hover hover:text-text"
        >
          <X size={13} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 overflow-y-auto">
        {run.isError ? (
          <p className="p-3 type-small text-bad">{run.error.message}</p>
        ) : null}

        {run.data ? (
          <>
            <Grid
              items={[
                ["Sequence", count(run.data.last_sequence)],
                [
                  "Took",
                  run.data.opened_at
                    ? duration(between(run.data.opened_at, run.data.closed_at ?? run.data.last_event_at))
                    : "not recorded",
                ],
                ["Writes", count(run.data.n_writes)],
                ["Premises set", count(run.data.n_premise_sets)],
                ["Events", count(run.data.n_events)],
                ["Store", run.data.store ?? "not recorded"],
              ]}
            />

            {run.data.unfinished.length ? (
              <Alarm
                title={`${run.data.unfinished.length} agents did not finish`}
                detail={`${run.data.unfinished.join(", ")} were still working when the run closed. Their work was discarded.`}
              />
            ) : null}

            <Section title="Agents">
              {digest.agents.length === 0 ? (
                <Nothing>No agent registered on this board.</Nothing>
              ) : (
                digest.agents.map((agent) => (
                  <div key={agent.name} className="row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate type-caption text-text">{agent.name}</span>
                      {run.data!.unfinished.includes(agent.name) ? (
                        <AlertTriangle size={11} className="shrink-0 text-warn" aria-label="did not finish" />
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 type-caption figures text-text-2">
                      <Stat value={agent.writes} label="wrote" />
                      <Stat value={agent.acked} label="acked" of={agent.dispatched} />
                      {agent.refused ? <Stat value={agent.refused} label="refused" tone="warn" /> : null}
                      {agent.failed ? <Stat value={agent.failed} label="undelivered" tone="bad" /> : null}
                    </span>
                  </div>
                ))
              )}
            </Section>

            <Section title="Regions">
              {run.data.regions.length === 0 ? (
                <Nothing>No region was declared.</Nothing>
              ) : (
                run.data.regions.map((region) => (
                  <div key={`${region.kind}-${region.name}`} className="row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5">
                    <span className="flex min-w-0 items-center gap-1.5 type-caption">
                      <span className="chip type-caption shrink-0 py-0">{region.kind}</span>
                      <span className="truncate text-text">{region.name}</span>
                    </span>
                    <span className="shrink-0 type-caption figures text-text-2">
                      {count(digest.regions[region.name]?.writes ?? 0)} writes
                      {digest.regions[region.name]?.bytes
                        ? `, ${bytes(digest.regions[region.name].bytes)}`
                        : ""}
                    </span>
                  </div>
                ))
              )}
            </Section>

            {digest.trouble.length ? (
              <Section title="Trouble">
                {digest.trouble.map((item) => (
                  <div key={item.id} className="row px-3 py-1.5">
                    <p className="flex items-center gap-1.5 type-caption">
                      <span className={cn(item.tone === "bad" ? "text-bad" : "text-warn")}>{item.title}</span>
                      <span className="figures text-text-2">
                        {since(run.data!.opened_at, item.at)}
                      </span>
                    </p>
                    <p className="type-caption text-text-2">{item.detail}</p>
                  </div>
                ))}
              </Section>
            ) : null}

            <div className="p-3">
              <Link
                to={`/p/${project}/boards/${encodeURIComponent(boardId)}?view=events`}
                className="move-state inline-flex items-center gap-1 rounded-sm type-caption text-live hover:underline"
              >
                All {count(run.data.n_events)} events
                <ArrowUpRight size={12} aria-hidden />
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

function Stat({
  value,
  label,
  of,
  tone,
}: {
  value: number;
  label: string;
  of?: number;
  tone?: "warn" | "bad";
}) {
  return (
    <span className={cn(tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>
      <span className="text-text">{count(value)}</span>
      {of === undefined ? "" : `/${count(of)}`} {label}
    </span>
  );
}

function Grid({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-3 border-b border-rule">
      {items.map(([term, value]) => (
        <div key={term} className="border-b border-hairline px-3 py-1.5 last:border-b-0 [&:nth-last-child(-n+3)]:border-b-0">
          <dt className="type-label">{term}</dt>
          <dd className="figures truncate type-caption text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-rule">
      <h3 className="type-label px-3 pt-2 pb-1">{title}</h3>
      {children}
    </section>
  );
}

function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-2 type-caption text-text-2">{children}</p>;
}

function Alarm({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-b border-rule bg-warn-wash px-3 py-2">
      <p className="flex items-center gap-1.5 type-caption text-warn">
        <AlertTriangle size={12} aria-hidden />
        {title}
      </p>
      <p className="type-caption text-text-2">{detail}</p>
    </div>
  );
}

interface AgentDigest {
  name: string;
  writes: number;
  dispatched: number;
  acked: number;
  refused: number;
  failed: number;
}

interface Trouble {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone: "warn" | "bad";
}

/**
 * What the events say, per agent and per region.
 *
 * Counted here rather than asked of the server, because the panel already has
 * every event it needs for the graph view next to it and a second round trip
 * for numbers it can add up would be a request made out of habit.
 */
function summarise(events: RunEvent[]): {
  agents: AgentDigest[];
  regions: Record<string, { writes: number; bytes: number }>;
  trouble: Trouble[];
} {
  const agents = new Map<string, AgentDigest>();
  const regions: Record<string, { writes: number; bytes: number }> = {};
  const trouble: Trouble[] = [];

  const of = (name: string): AgentDigest => {
    let found = agents.get(name);
    if (!found) {
      found = { name, writes: 0, dispatched: 0, acked: 0, refused: 0, failed: 0 };
      agents.set(name, found);
    }
    return found;
  };

  for (const event of events) {
    if (event.kind === "agent.registered" && event.agent) of(event.agent);
    if (!event.agent) continue;
    const agent = of(event.agent);
    switch (event.kind) {
      case "write.admitted":
      case "premise.set": {
        agent.writes += 1;
        if (event.region) {
          const region = (regions[event.region] ??= { writes: 0, bytes: 0 });
          region.writes += 1;
          region.bytes += event.body.content?.bytes ?? 0;
        }
        break;
      }
      case "write.refused":
        agent.refused += 1;
        trouble.push({
          id: `r${event.id}`,
          title: `${event.agent} refused on ${event.region ?? "a region"}`,
          detail: event.body.reason || event.body.cause || "the rule gave no reason",
          at: event.at,
          tone: "warn",
        });
        break;
      case "write.conflicted":
        trouble.push({
          id: `c${event.id}`,
          title: `${event.agent} conflicted on ${event.region ?? "a premise"}`,
          detail: `Expected version ${event.body.expected_version ?? "none"}, found ${
            event.body.current_version ?? "none"
          }.`,
          at: event.at,
          tone: "warn",
        });
        break;
      case "notification.dispatched":
        agent.dispatched += 1;
        break;
      case "notification.acknowledged":
        agent.acked += 1;
        break;
      case "notification.failed":
        agent.failed += 1;
        trouble.push({
          id: `f${event.id}`,
          title: `${event.agent} was never told`,
          detail: `${
            event.body.error ?? "Delivery raised"
          }. The notification did not arrive, so this agent did not see the write.`,
          at: event.at,
          tone: "bad",
        });
        break;
      default:
        break;
    }
  }

  return {
    agents: [...agents.values()].sort((a, b) => b.writes - a.writes || a.name.localeCompare(b.name)),
    regions,
    // Undelivered first: an agent that was never told is a different problem
    // from a write the rule declined, and it is the one nobody else reports.
    trouble: trouble.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "bad" ? -1 : 1)).slice(0, 12),
  };
}
