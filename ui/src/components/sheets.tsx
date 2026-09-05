/**
 * What each kind of layer holds.
 *
 * Each fetches what it needs by the same query key the canvas used, so opening
 * a layer over a run you are already reading costs no request.
 */
import { Field, Sheet } from "@/components/Sheet";
import { RunState, State } from "@/components/State";
import { Skeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/States";
import { useAgent, useHealth, useProjects, useRun, useRunEvents } from "@/lib/api";
import { cn } from "@/lib/cn";
import { KIND_LABEL, type Carried, type RunEvent } from "@/lib/events";
import { bytes, clock, count, duration, instant } from "@/lib/format";

export function EventSheet({
  boardId,
  eventId,
  depth,
  closing,
  backTo,
  onBack,
  onAgent,
}: {
  boardId: string;
  eventId: number;
  depth: number;
  closing: boolean;
  backTo: string;
  onBack: () => void;
  onAgent: (name: string) => void;
}) {
  const run = useRun(boardId);
  const events = useRunEvents(boardId, run.data?.outcome === null);
  const event = events.data?.events.find((one) => one.id === eventId);

  return (
    <Sheet
      title={event ? KIND_LABEL[event.kind] : "Event"}
      backTo={backTo}
      depth={depth}
      closing={closing}
      onBack={onBack}
    >
      {events.isLoading ? (
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      ) : !event ? (
        <p className="p-6 type-small text-text-2">
          That event is not in this run any more. It may have been trimmed.
        </p>
      ) : (
        <>
          <div className="px-4 pb-3 pt-5">
            <div className="type-label">
              {event.sequence !== null ? "Sequence" : "Took no sequence"}
            </div>
            <div className="figures type-display font-semibold">
              {event.sequence ?? "none"}
            </div>
            {event.sequence === null ? (
              <p className="pt-1 type-caption text-text-2">
                This did not change the board. It is something the run did about it.
              </p>
            ) : null}
          </div>

          {event.agent ? (
            <Field label="Agent">
              <button
                type="button"
                onClick={() => onAgent(event.agent!)}
                className="text-live underline-offset-2 hover:underline"
              >
                {event.agent}
              </button>
            </Field>
          ) : null}
          {event.region ? (
            <Field label="Region">
              <span className="code">{event.region}</span>
            </Field>
          ) : null}
          <Field label="Sent at">
            {instant(event.at)}
            <span className="figures code pl-2 text-text-2">{clock(event.at)}</span>
          </Field>
          <Body event={event} />
          <Field label="Event id">
            <span className="code break-all text-text-2">{event.event_id}</span>
          </Field>
        </>
      )}
    </Sheet>
  );
}

function Body({ event }: { event: RunEvent }) {
  switch (event.kind) {
    case "run.opened":
      return (
        <>
          <Field label="Store">{event.body.store ?? "not recorded"}</Field>
          <Field label="Limits">
            <span className="figures">
              wall clock {event.body.limits?.wall_clock_seconds ?? "?"}s, idle{" "}
              {event.body.limits?.idle_seconds ?? "?"}s
            </span>
          </Field>
          <Field label="Regions">
            <ul className="flex flex-col gap-1">
              {(event.body.regions ?? []).map((region) => (
                <li key={region.name} className="code flex justify-between gap-3">
                  <span>{region.name}</span>
                  <span className="text-text-2">{region.kind}</span>
                </li>
              ))}
            </ul>
          </Field>
          <Field label="Admission">
            {event.body.has_admission_rule
              ? "A rule judges every proposed write."
              : "No rule, so a write is accepted subject to the region and the limits."}
          </Field>
        </>
      );
    case "agent.registered":
      return (
        <>
          <Field label="Subscribes to">
            <span className="code">
              {event.body.subscribes_to?.join(", ") ??
                "every premise and no level, which is the default"}
            </span>
          </Field>
          <Field label="Writes to">
            <span className="code">{event.body.writes_to?.join(", ") ?? "every level"}</span>
          </Field>
        </>
      );
    case "write.refused":
      return (
        <>
          <Field label="Cause">
            <span className="code">{event.body.cause}</span>
          </Field>
          <Field label="Reason">
            <span className="text-warn">{event.body.reason}</span>
          </Field>
          <Content carried={event.body.content} />
        </>
      );
    case "write.conflicted":
      return (
        <>
          <Field label="Versions">
            <span className="figures text-warn">
              expected v{event.body.expected_version}, the premise was at v
              {event.body.current_version}
            </span>
          </Field>
          <Content carried={event.body.content} />
        </>
      );
    case "write.admitted":
    case "premise.set":
      return (
        <>
          {event.body.version !== null ? (
            <Field label="Version">
              <span className="figures">v{event.body.version}</span>
            </Field>
          ) : null}
          {event.body.idempotency_key ? (
            <Field label="Idempotency key">
              <span className="code break-all">{event.body.idempotency_key}</span>
            </Field>
          ) : null}
          {event.body.repeated ? (
            <Field label="Repeated">
              This key had already written. Nothing was added to the board.
            </Field>
          ) : null}
          <Content carried={event.body.content} />
        </>
      );
    case "notification.dispatched":
      return (
        <>
          <Field label="Notification">
            <span className="figures">{event.body.notification_id}</span>
          </Field>
          <Field label="Range">
            <span className="figures">
              {event.body.from_sequence} to {event.body.to_sequence}
            </span>
          </Field>
          <Field label="Regions that changed">
            <span className="code">{event.body.regions.join(", ") || "none named"}</span>
          </Field>
        </>
      );
    case "notification.acknowledged":
      return (
        <Field label="Notification">
          <span className="figures">{event.body.notification_id}</span>
        </Field>
      );
    case "notification.failed":
      return (
        <>
          <Field label="Notification">
            <span className="figures">{event.body.notification_id}</span>
          </Field>
          <Field label="Error">
            <span className="code text-bad">{event.body.error}</span>
          </Field>
          <Field label="Detail">
            <span className="text-bad">{event.body.detail}</span>
          </Field>
          <Field label="What this means">
            The agent never received this notification. The control component
            contained the exception, so the run carried on and this agent was
            never told what it was owed.
          </Field>
        </>
      );
    case "run.closed":
      return (
        <>
          <Field label="Outcome">{event.body.outcome.replace(/_/g, " ")}</Field>
          {event.body.reason ? <Field label="Reason">{event.body.reason}</Field> : null}
          <Field label="Unfinished">
            {event.body.unfinished.length ? (
              <span className="text-bad">{event.body.unfinished.join(", ")}</span>
            ) : (
              "none. Every agent acknowledged what it was sent."
            )}
          </Field>
        </>
      );
    default:
      return null;
  }
}

function Content({ carried }: { carried: Carried }) {
  return (
    <Field label="Content">
      <p className="figures type-caption text-text-2">
        {carried.type}, {bytes(carried.bytes)}
        {carried.truncated ? ", truncated" : ""}
      </p>
      {carried.content !== undefined || carried.preview ? (
        <pre className="code mt-2 max-h-72 overflow-auto rounded-md border border-hairline bg-canvas p-3 text-text-2">
          <code>
            {carried.content !== undefined
              ? JSON.stringify(carried.content, null, 2)
              : carried.preview}
          </code>
        </pre>
      ) : (
        <p className="pt-1 type-caption text-text-2">
          This deployment sends no content, so the size and shape above are the
          whole record of it.
        </p>
      )}
    </Field>
  );
}

export function AgentSheet({
  name,
  depth,
  closing,
  backTo,
  onBack,
  onRun,
}: {
  name: string;
  depth: number;
  closing: boolean;
  backTo: string;
  onBack: () => void;
  onRun: (boardId: string) => void;
}) {
  const agent = useAgent(name);
  const owing = agent.data ? agent.data.dispatched - agent.data.acked : 0;

  return (
    <Sheet title={name} backTo={backTo} depth={depth} closing={closing} onBack={onBack}>
      {agent.isError ? <ErrorState error={agent.error} className="m-4" /> : null}
      {agent.isLoading ? (
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      ) : null}
      {agent.data ? (
        <>
          <div className="px-4 pb-4 pt-5">
            <h2 className="type-title">{agent.data.agent}</h2>
            <p className="pt-1 type-small text-text-2">
              Seen in {count(agent.data.runs)} runs ·{" "}
              {agent.data.median_response === null
                ? "never answered a notification"
                : `answers in ${duration(agent.data.median_response)}`}
            </p>
            <div className="flex flex-wrap gap-1.5 pt-3">
              <span className="chip figures type-caption">
                {count(agent.data.writes + agent.data.premise_sets)} writes
              </span>
              {agent.data.refusals ? (
                <span className="chip figures type-caption border-edge text-warn">
                  {count(agent.data.refusals)} refused
                </span>
              ) : null}
              <span
                className={cn(
                  "chip figures type-caption",
                  owing > 0 && "border-bad-edge text-bad"
                )}
              >
                {count(agent.data.dispatched)} notified · {count(agent.data.acked)} answered
              </span>
              {agent.data.failed ? (
                <span className="chip figures type-caption border-bad-edge text-bad">
                  {count(agent.data.failed)} never arrived
                </span>
              ) : null}
            </div>
          </div>

          {agent.data.unfinished_in ? (
            <div className="mx-4 mb-4 rounded-md border border-bad-edge bg-bad-wash px-3 py-2">
              <State tone="bad">
                Named unfinished in {count(agent.data.unfinished_in)}{" "}
                {agent.data.unfinished_in === 1 ? "run" : "runs"}
              </State>
            </div>
          ) : null}

          <Field label="Subscribes to">
            <span className="code">
              {agent.data.subscribes_to?.join(", ") ??
                "every premise and no level, which is the default"}
            </span>
          </Field>
          <Field label="Writes to">
            <span className="code">
              {agent.data.writes_to?.join(", ") ?? "every level"}
            </span>
          </Field>
          <div className="px-4 py-3">
            <div className="type-label pb-2">Runs it took part in</div>
            <ul className="flex flex-col">
              {agent.data.runs_seen.map((run) => (
                <li key={run.board_id}>
                  <button
                    type="button"
                    onClick={() => onRun(run.board_id)}
                    className="move-state flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-hover"
                  >
                    <span className="code min-w-0 flex-1 truncate">{run.board_id}</span>
                    {run.unfinished.includes(agent.data!.agent) ? (
                      <span className="type-caption text-bad">left unfinished</span>
                    ) : null}
                    <RunState outcome={run.outcome} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

export function SettingsSheet({
  depth,
  closing,
  onBack,
}: {
  depth: number;
  closing: boolean;
  onBack: () => void;
}) {
  const projects = useProjects();
  const health = useHealth();
  return (
    <Sheet title="Settings" backTo="Runs" depth={depth} closing={closing} onBack={onBack}>
      <div className="px-4 pb-3 pt-5">
        <h2 className="type-title">Settings</h2>
        {health.data ? (
          <p className="figures pt-1 type-small text-text-2">
            Platform {health.data.status} · schema {health.data.schema_version} ·{" "}
            {health.data.kinds.length} event kinds
          </p>
        ) : null}
      </div>

      <div className="px-4 py-3">
        <div className="type-label pb-2">Projects</div>
        <ul className="flex flex-col gap-2">
          {(projects.data?.projects ?? []).map((project) => (
            <li key={project.id} className="flex items-baseline gap-3">
              <span className="code">{project.slug}</span>
              <span className="figures ml-auto type-caption text-text-2">
                {count(project.runs)} runs
              </span>
              <span className="figures type-caption text-text-2">
                {count(project.keys)} {project.keys === 1 ? "key" : "keys"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Field label="Issuing a key">
        <p className="pb-2 type-caption text-text-2">
          A key is shown once. The database holds its hash, so the platform can
          check a token it is shown and cannot show one it was given.
        </p>
        <pre className="code overflow-x-auto rounded-md border border-hairline bg-canvas p-3">
          <code>blackboardxray key production</code>
        </pre>
      </Field>

      <div className="px-4 py-3">
        <div className="type-label pb-2">What this platform does not do</div>
        <dl className="flex flex-col gap-3">
          <Limit label="It does not authenticate a reader">
            Ingestion needs a key. Reading is open to whoever can reach the
            server, so put it behind whatever already fronts your internal tools.
          </Limit>
          <Limit label="A contribution is truncated past 4kB">
            Content is recorded. Passing content_limit=0 records the size and the
            shape and none of the content.
          </Limit>
          <Limit label="A dropped event leaves a hole nothing repairs">
            The sender's queue is bounded, so a platform that is down loses events
            rather than stalling a run. Nothing backfills them afterwards.
          </Limit>
        </dl>
      </div>
    </Sheet>
  );
}

function Limit({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="type-small font-medium">{label}</dt>
      <dd className="pt-0.5 type-caption text-text-2">{children}</dd>
    </div>
  );
}
