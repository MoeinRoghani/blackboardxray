/**
 * What is actually on the board.
 *
 * The other two views are about what the run did. This one is about what it
 * produced: each region, in order, with the contributions that landed in it
 * and the premise versions that were set.
 *
 * Content is shown where the application opted in to sending it. Where it did
 * not, the size and the shape are shown and the value is not, which is the
 * platform keeping the promise it makes in its own documentation rather than
 * a gap in the view.
 */
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { bytes, count, since } from "@/lib/format";
import type { Carried, RunEvent } from "@/lib/events";
import type { Run } from "@/lib/api";

interface Entry {
  id: number;
  at: string;
  agent: string | null;
  sequence: number | null;
  content: Carried | undefined;
  repeated: boolean;
}

export function BoardContents({ run, events }: { run: Run; events: RunEvent[] }) {
  const byRegion = useMemo(() => {
    const found: Record<string, Entry[]> = {};
    for (const event of events) {
      if (event.kind !== "write.admitted" && event.kind !== "premise.set") continue;
      if (!event.region) continue;
      (found[event.region] ??= []).push({
        id: event.id,
        at: event.at,
        agent: event.agent,
        sequence: event.sequence,
        content: event.body.content,
        repeated: event.body.repeated ?? false,
      });
    }
    return found;
  }, [events]);

  return (
    <div className="min-h-0 overflow-y-auto p-3 scroll-end">
      <div className="mx-auto grid max-w-4xl gap-2">
        {run.regions.length === 0 ? (
          <p className="type-small text-text-2">This run declared no region.</p>
        ) : null}
        {run.regions.map((region) => (
          <Region
            key={`${region.kind} ${region.name}`}
            name={region.name}
            kind={region.kind}
            batch={region.batch_window_seconds}
            entries={byRegion[region.name] ?? []}
            openedAt={run.opened_at}
          />
        ))}
      </div>
    </div>
  );
}

function Region({
  name,
  kind,
  batch,
  entries,
  openedAt,
}: {
  name: string;
  kind: string;
  batch: number;
  entries: Entry[];
  openedAt: string | null;
}) {
  const [open, setOpen] = useState(entries.length > 0);
  const total = entries.reduce((sum, entry) => sum + (entry.content?.bytes ?? 0), 0);

  return (
    <section className="overflow-hidden rounded-md border border-rule bg-plane">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="move-state flex w-full items-center gap-2 bg-plane-2 px-3 py-2 text-left hover:bg-hover"
      >
        <ChevronRight
          size={13}
          aria-hidden
          className={cn("move-state shrink-0 text-text-2", open && "rotate-90")}
        />
        <span className="chip type-caption shrink-0 py-0">{kind}</span>
        <span className="truncate type-small text-text">{name}</span>
        <span className="flex-1" />
        <span className="shrink-0 type-caption figures text-text-2">
          {count(entries.length)} writes
          {total ? `, ${bytes(total)}` : ""}
          {batch > 0 ? `, batched ${batch}s` : ""}
        </span>
      </button>

      {open ? (
        entries.length === 0 ? (
          <p className="px-3 py-2 type-caption text-text-2">Nothing was written here.</p>
        ) : (
          <ol>
            {entries.map((entry) => (
              <li key={entry.id} className="row px-3 py-1.5 last:border-b-0">
                <div className="flex items-baseline gap-2 type-caption">
                  <span className="figures shrink-0 text-text-2">
                    {entry.sequence === null ? "" : `#${entry.sequence}`}
                  </span>
                  <span className="truncate text-text">{entry.agent ?? "unattributed"}</span>
                  <span className="figures shrink-0 text-text-2">
                    {since(openedAt, entry.at)}
                  </span>
                  {entry.repeated ? (
                    <span className="chip type-caption shrink-0 py-0">repeated</span>
                  ) : null}
                  <span className="flex-1" />
                  <span className="shrink-0 type-caption figures text-text-2">
                    {entry.content ? `${entry.content.type}, ${bytes(entry.content.bytes)}` : ""}
                  </span>
                </div>
                <Content carried={entry.content} />
              </li>
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}

function Content({ carried }: { carried: Carried | undefined }) {
  if (!carried) return null;
  if (carried.unreadable) {
    return (
      <p className="pt-1 type-caption text-warn">
        This contribution could not be encoded, so its size was not recorded either.
      </p>
    );
  }
  if (carried.content === undefined && carried.preview === undefined) {
    return (
      <p className="pt-1 type-caption text-text-2">
        Content was not sent. This project records the size and the shape of a contribution and
        not its value.
      </p>
    );
  }
  const rendered =
    carried.preview ?? JSON.stringify(carried.content, null, 2) ?? "";
  return (
    <pre className="code mt-1 max-h-40 overflow-auto rounded-sm bg-well px-2 py-1.5 text-text-2">
      {rendered}
      {carried.truncated ? "\n... truncated at the project's content limit" : ""}
    </pre>
  );
}
