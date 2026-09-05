/**
 * The home surface: is anything wrong, and what is the fleet doing.
 *
 * It is what the canvas shows before a run is chosen, so it is not a separate
 * destination and choosing a run in the list simply replaces it.
 *
 * Two things here are deliberately not charts. Runs needing attention is one
 * number, and a chart of one number is the most common way a chart misses its
 * point. Write outcomes are three counts whose story is the two exceptions,
 * so they are three figures with the exceptions in their own ink.
 */
import { Activity, ArrowRight, ChevronLeft } from "lucide-react";
import { Bar } from "@/components/Bar";
import { RunState } from "@/components/State";
import { Skeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import { useOverview, type Overview as Data } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ago, count, duration } from "@/lib/format";

export function Overview({
  onRun,
  onAgent,
  onFilter,
  onBackToList,
}: {
  onRun: (boardId: string) => void;
  onAgent: (name: string) => void;
  onFilter: (outcome: string) => void;
  /** Below the two-pane breakpoint the list is not on screen. */
  onBackToList: () => void;
}) {
  const overview = useOverview();

  if (overview.isError) return <ErrorState error={overview.error} className="m-5" />;

  if (overview.isLoading || !overview.data) {
    return (
      <div className="flex flex-col gap-4 p-5">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }

  const data = overview.data;
  if (data.runs === 0) return <FirstRun />;

  const needing = data.recent.filter(
    (run) => run.unfinished.length > 0 || run.n_failed > 0
  );
  const wrong = data.with_unfinished + (data.failed > 0 ? 1 : 0);

  return (
    // Held at reduced opacity while refetching rather than replaced by a
    // skeleton, so nothing jumps when the poll lands.
    <div
      className={cn(
        "flex flex-col gap-6 p-4 sm:p-6",
        overview.isFetching && "opacity-70"
      )}
    >
      <button
        type="button"
        onClick={onBackToList}
        className="move-state -ml-1 -mt-1 inline-flex w-fit items-center gap-0.5 rounded-sm px-1 py-1 type-small text-live md:hidden"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
        Runs
      </button>
      <Headline data={data} onFilter={onFilter} wrong={wrong} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="How runs are ending"
          note={`${count(data.runs)} observed`}
        >
          {/* Four labelled rows rather than one stacked bar. Green, amber and
              red cannot be told apart under protan vision, which is why status
              colour is reserved and always carries a word: giving each state
              its own labelled row means colour never has to do the telling. */}
          <Bar label="Settled" value={data.settled} of={data.runs} tone="ok"
               onClick={() => onFilter("settled")} title="Nothing happened for the idle limit" />
          <Bar label="Open" value={data.open} of={data.runs} tone="live"
               onClick={() => onFilter("open")} title="Still going" />
          <Bar label="Wall clock expired" value={data.expired} of={data.runs} tone="warn"
               onClick={() => onFilter("wall_clock_expired")} title="The wall clock limit passed while the run was open" />
          <Bar label="Aborted" value={data.aborted} of={data.runs} tone="bad"
               onClick={() => onFilter("aborted")} title="A caller closed the run" />
        </Panel>

        <Panel
          title="How fast agents answer"
          note="dispatch to acknowledgment, median"
        >
          {data.busiest_agents.length === 0 ? (
            <p className="px-1.5 py-3 type-caption text-text-2">
              No agent has answered a notification yet.
            </p>
          ) : (
            data.busiest_agents.map((agent) => {
              // The scale is in seconds, not rounded milliseconds. An agent
              // answering in 600 microseconds is a real magnitude, and
              // rounding it to zero throws the whole comparison away.
              const slowest = Math.max(
                ...data.busiest_agents.map((one) => one.median_response ?? 0)
              );
              const never = agent.median_response === null;
              return (
                <Bar
                  key={agent.agent}
                  label={agent.agent}
                  value={never ? 0 : agent.median_response!}
                  of={slowest || 1}
                  tone={never ? "bad" : "neutral"}
                  display={never ? "never" : duration(agent.median_response!)}
                  onClick={() => onAgent(agent.agent)}
                  title={
                    never
                      ? `${agent.agent} has never acknowledged a notification`
                      : `${agent.agent}: ${duration(agent.median_response!)} across ${count(agent.runs)} runs`
                  }
                />
              );
            })
          )}
        </Panel>
      </div>

      <Panel title="What the boards took" note="across every run">
        <div className="flex flex-wrap gap-x-8 gap-y-3 px-1.5 py-1">
          <Figure label="admitted" value={data.writes} />
          <Figure label="refused" value={data.refusals} tone="warn" />
          <Figure label="premises conflicted" value={data.conflicts} tone="warn" />
          <Figure label="notified" value={data.dispatched} />
          <Figure label="acknowledged" value={data.acked} />
          <Figure label="never delivered" value={data.failed} tone="bad" />
        </div>
      </Panel>

      {needing.length ? (
        <Panel title="Where those runs stopped" note="what the sidebar cannot show">
          <ul className="flex flex-col divide-y divide-hairline">
            {needing.map((run) => (
              <li key={run.board_id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <button
                    type="button"
                    onClick={() => onRun(run.board_id)}
                    className="code move-state rounded-sm font-medium underline-offset-2 hover:text-live hover:underline"
                  >
                    {run.board_id}
                  </button>
                  <RunState outcome={run.outcome} />
                  <span className="figures type-caption text-text-2">
                    {count(run.last_sequence)} on board
                  </span>
                  <span className="ml-auto type-caption text-text-2">
                    {ago(run.last_event_at)}
                  </span>
                </div>
                <p className="max-w-prose pt-1 type-caption text-bad">
                  {run.unfinished.map((name, index) => (
                    <span key={name}>
                      {index ? ", " : ""}
                      <button
                        type="button"
                        onClick={() => onAgent(name)}
                        className="underline underline-offset-2 hover:opacity-80"
                      >
                        {name}
                      </button>
                    </span>
                  ))}
                  {run.unfinished.length
                    ? " held an unacknowledged notification when the run closed."
                    : null}
                  {run.n_failed
                    ? ` ${count(run.n_failed)} never reached the agent they were for.`
                    : null}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

/**
 * The one number the page exists to answer.
 *
 * Proportional figures rather than tabular: equal-width digits make a large
 * standalone number look loose, and nothing is aligning under it.
 */
function Headline({
  data,
  wrong,
  onFilter,
}: {
  data: Data;
  wrong: number;
  onFilter: (outcome: string) => void;
}) {
  const healthy = wrong === 0;
  return (
    <section
      className={cn(
        "rounded-lg border px-5 py-4",
        healthy ? "border-hairline bg-surface" : "border-bad-edge bg-bad-wash"
      )}
    >
      {healthy ? (
        <>
          <h1 className="type-title">Nothing needs attention</h1>
          <p className="max-w-prose pt-1 type-small text-text-2">
            No run has left an agent unfinished and every notification arrived.{" "}
            <span className="figures">{count(data.open)}</span>{" "}
            {data.open === 1 ? "run is" : "runs are"} still open.
          </p>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="type-display font-semibold text-bad">
              {count(data.with_unfinished)}
            </span>
            <h1 className="type-title text-bad">
              {data.with_unfinished === 1 ? "run" : "runs"} left an agent unfinished
            </h1>
          </div>
          <p className="max-w-prose pt-1.5 type-small text-bad">
            {data.failed
              ? `${count(data.failed)} notifications never reached the agent they were for. `
              : ""}
            An agent that is named unfinished held work the run never got an
            answer for.
          </p>
          <button
            type="button"
            onClick={() => onFilter("")}
            className="move-state mt-3 inline-flex items-center gap-1 type-small text-bad underline underline-offset-2 hover:opacity-80"
          >
            Show every run
            <ArrowRight aria-hidden className="size-3.5" />
          </button>
        </>
      )}
    </section>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="plane p-4">
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h2 className="type-heading">{title}</h2>
        {note ? <span className="type-caption text-text-2">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warn" | "bad";
}) {
  const ink =
    tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="flex flex-col">
      <span className={cn("type-title font-semibold", value === 0 ? "text-text-2" : ink)}>
        {count(value)}
      </span>
      <span className="type-caption text-text-2">{label}</span>
    </div>
  );
}

function FirstRun() {
  return (
    <div className="max-w-3xl p-6">
      <EmptyState
        icon={Activity}
        title="Nothing has been observed yet"
        command={`export BLACKBOARDXRAY_ENDPOINT=http://localhost:8900\nexport BLACKBOARDXRAY_TOKEN=bxr_...\n\nfrom blackboardxray import Xray\nxray = Xray.from_env()\nmodel = xray.create_model(board_id=..., store=..., regions=..., premises=..., limits=...)`}
      >
        Point an application at this endpoint with a token and the runs it opens
        appear on the left. The library is not modified: Xray.create_model takes
        the arguments blackboard.create_model takes and returns the model it
        returns.
      </EmptyState>
    </div>
  );
}
