/**
 * One event, in full.
 *
 * The spine answers what happened and in what order. This answers what was in
 * it, including the parts a row has no room for: the whole reason string, the
 * subscription set an agent registered with, the content a deployment opted
 * into carrying.
 */
import { X } from "lucide-react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { bytes, clock, instant } from "@/lib/format";
import { KIND_LABEL, KIND_TONE, type Carried, type RunEvent } from "@/lib/events";

export function Inspector({
  event,
  onClose,
}: {
  event: RunEvent;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Event detail"
      className="flex h-full flex-col overflow-y-auto border-border-subtle bg-surface-raised lg:border-l"
    >
      <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-border-subtle bg-surface-raised p-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Badge tone={KIND_TONE[event.kind]}>{KIND_LABEL[event.kind]}</Badge>
          <p className="numeric type-caption text-text-secondary">
            {event.sequence !== null
              ? `sequence ${event.sequence}`
              : "took no sequence number"}
          </p>
        </div>
        <Button emphasis="ghost" size="sm" onClick={onClose} aria-label="Close">
          <X aria-hidden className="size-3.5" />
        </Button>
      </header>

      <dl className="divide-y divide-border-subtle">
        <Field label="Agent">{event.agent ?? "none"}</Field>
        <Field label="Region">{event.region ?? "none"}</Field>
        <Field label="Sent at">
          {instant(event.at)}
          <span className="numeric ml-2 text-text-secondary">{clock(event.at)}</span>
        </Field>
        <Field label="Received at">{instant(event.received_at)}</Field>
        <Body event={event} />
        <Field label="Event id">
          <span className="numeric break-all">{event.event_id}</span>
        </Field>
      </dl>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="type-label text-text-secondary">{label}</dt>
      <dd className="type-small break-words text-text-primary">{children}</dd>
    </div>
  );
}

/** The kind-specific half. The discriminated union is what makes this safe. */
function Body({ event }: { event: RunEvent }) {
  switch (event.kind) {
    case "run.opened":
      return (
        <>
          <Field label="Store">{event.body.store ?? "not recorded"}</Field>
          <Field label="Limits">
            <span className="numeric">
              wall clock {event.body.limits?.wall_clock_seconds ?? "?"}s, idle{" "}
              {event.body.limits?.idle_seconds ?? "?"}s
            </span>
          </Field>
          <Field label="Regions">
            <ul className="flex flex-col gap-1">
              {(event.body.regions ?? []).map((region) => (
                <li key={region.name} className="numeric flex justify-between gap-3">
                  <span>{region.name}</span>
                  <span className="text-text-secondary">{region.kind}</span>
                </li>
              ))}
            </ul>
          </Field>
          <Field label="Rules">
            {event.body.has_admission_rule
              ? "An admission rule judges every proposed write."
              : "No admission rule, so every write is accepted subject to the region and the limits."}
          </Field>
        </>
      );
    case "agent.registered":
      return (
        <>
          <Field label="Subscribes to">
            {event.body.subscribes_to?.join(", ") ??
              "every premise, and no level, which is the default"}
          </Field>
          <Field label="Writes to">
            {event.body.writes_to?.join(", ") ?? "every level"}
          </Field>
        </>
      );
    case "write.refused":
      return (
        <>
          <Field label="Cause">
            <span className="numeric">{event.body.cause}</span>
          </Field>
          <Field label="Reason">{event.body.reason}</Field>
          <Content carried={event.body.content} />
        </>
      );
    case "write.conflicted":
      return (
        <>
          <Field label="Versions">
            <span className="numeric">
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
              <span className="numeric">v{event.body.version}</span>
            </Field>
          ) : null}
          {event.body.idempotency_key ? (
            <Field label="Idempotency key">
              <span className="numeric break-all">{event.body.idempotency_key}</span>
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
            <span className="numeric">{event.body.notification_id}</span>
          </Field>
          <Field label="Range">
            <span className="numeric">
              {event.body.from_sequence} to {event.body.to_sequence}
            </span>
          </Field>
          <Field label="Regions that changed">
            {event.body.regions.join(", ") || "none named"}
          </Field>
        </>
      );
    case "notification.acknowledged":
      return (
        <Field label="Notification">
          <span className="numeric">{event.body.notification_id}</span>
        </Field>
      );
    case "notification.failed":
      return (
        <>
          <Field label="Notification">
            <span className="numeric">{event.body.notification_id}</span>
          </Field>
          <Field label="Error">
            <span className="numeric">{event.body.error}</span>
          </Field>
          <Field label="Detail">{event.body.detail}</Field>
          <Field label="What this means">
            The agent never received this notification. The control component
            contained the exception, so the run carried on and this agent was
            not told what it was owed.
          </Field>
        </>
      );
    case "run.closed":
      return (
        <>
          <Field label="Outcome">{event.body.outcome.replace(/_/g, " ")}</Field>
          {event.body.reason ? (
            <Field label="Reason">{event.body.reason}</Field>
          ) : null}
          <Field label="Unfinished">
            {event.body.unfinished.length
              ? event.body.unfinished.join(", ")
              : "none. Every agent acknowledged what it was sent."}
          </Field>
        </>
      );
    default:
      return null;
  }
}

/**
 * What was kept of a contribution.
 *
 * Content is recorded by default and truncated past the sender's limit. A
 * deployment whose contributions may not leave the process sends none, and
 * then the size and the shape are the whole record.
 */
function Content({ carried }: { carried: Carried }) {
  return (
    <Field label="Content">
      <p className="numeric type-caption text-text-secondary">
        {carried.type}, {bytes(carried.bytes)}
        {carried.truncated ? ", truncated" : ""}
      </p>
      {carried.content !== undefined ? (
        <pre className="numeric mt-2 max-h-64 overflow-auto rounded-sm border border-border-subtle bg-surface-sunken p-2 type-caption">
          <code>{JSON.stringify(carried.content, null, 2)}</code>
        </pre>
      ) : carried.preview ? (
        <pre className="numeric mt-2 max-h-64 overflow-auto rounded-sm border border-border-subtle bg-surface-sunken p-2 type-caption">
          <code>{carried.preview}</code>
        </pre>
      ) : (
        <p className="type-caption mt-1 text-text-secondary">
          This deployment sends no content, so the size and the shape above are
          the whole record of it.
        </p>
      )}
    </Field>
  );
}
