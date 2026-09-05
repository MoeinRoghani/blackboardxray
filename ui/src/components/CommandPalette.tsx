/**
 * One field that finds anything.
 *
 * The header's search opens it and so does the command key with K. It is the
 * only place in the product that mixes object kinds, because "find the thing I
 * am thinking of" does not know in advance whether the thing is a run or an
 * agent.
 */
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RunState } from "@/components/State";
import { useAgents, useRuns } from "@/lib/api";
import { cn } from "@/lib/cn";
import { count, duration } from "@/lib/format";

type Hit =
  | { kind: "run"; id: string; label: string; run: NonNullable<ReturnType<typeof useRuns>["data"]>["runs"][number] }
  | { kind: "agent"; id: string; label: string; runs: number; median: number | null };

export function CommandPalette({
  open,
  onClose,
  onRun,
  onAgent,
}: {
  open: boolean;
  onClose: () => void;
  onRun: (boardId: string) => void;
  onAgent: (name: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [at, setAt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const runs = useRuns({ limit: 100 });
  const agents = useAgents();

  useEffect(() => {
    if (!open) return;
    setTerm("");
    setAt(0);
    const frame = requestAnimationFrame(() => field.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const needle = term.trim().toLowerCase();
    const matched: Hit[] = [];
    for (const run of runs.data?.runs ?? []) {
      if (!needle || run.board_id.toLowerCase().includes(needle)) {
        matched.push({ kind: "run", id: run.board_id, label: run.board_id, run });
      }
    }
    for (const agent of agents.data?.agents ?? []) {
      if (!needle || agent.agent.toLowerCase().includes(needle)) {
        matched.push({
          kind: "agent",
          id: agent.agent,
          label: agent.agent,
          runs: agent.runs,
          median: agent.median_response,
        });
      }
    }
    return matched.slice(0, 12);
  }, [term, runs.data, agents.data]);

  useEffect(() => {
    setAt((current) => Math.min(current, Math.max(0, hits.length - 1)));
  }, [hits.length]);

  if (!open) return null;

  function choose(hit: Hit) {
    onClose();
    if (hit.kind === "run") onRun(hit.id);
    else onAgent(hit.id);
  }

  function onKey(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setAt((current) => Math.min(hits.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAt((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && hits[at]) {
      event.preventDefault();
      choose(hits[at]);
    }
  }

  const runHits = hits.filter((hit) => hit.kind === "run");
  const agentHits = hits.filter((hit) => hit.kind === "agent");

  return (
    <div
      className="scrim-in fixed inset-0 z-40 flex justify-center bg-canvas/60 px-4 pt-palette-top backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKey}
        className="rise plane h-fit w-full max-w-xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
          <Search aria-hidden className="size-4 text-text-2" />
          <input
            ref={field}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Find a run or an agent"
            aria-label="Find a run or an agent"
            className="code w-full bg-transparent text-text outline-none"
          />
          <kbd className="shrink-0 rounded-sm border border-edge px-1 py-0.5 type-caption text-text-2">
            esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {hits.length === 0 ? (
            <p className="px-4 py-6 type-small text-text-2">
              Nothing matches {term ? `"${term}"` : "yet"}.
            </p>
          ) : null}

          {runHits.length ? <div className="type-label px-4 py-1.5">Runs</div> : null}
          {runHits.map((hit) => (
            <Row
              key={hit.id}
              on={hits.indexOf(hit) === at}
              onHover={() => setAt(hits.indexOf(hit))}
              onPick={() => choose(hit)}
            >
              <span className="code truncate">{hit.label}</span>
              <RunState outcome={hit.run.outcome} />
              {hit.run.unfinished.length ? (
                <span className="ml-auto truncate type-caption text-bad">
                  {hit.run.unfinished.join(", ")} did not finish
                </span>
              ) : (
                <span className="figures ml-auto type-caption text-text-2">
                  {count(hit.run.last_sequence)} on board
                </span>
              )}
            </Row>
          ))}

          {agentHits.length ? (
            <div className="type-label px-4 py-1.5 pt-2">Agents</div>
          ) : null}
          {agentHits.map((hit) => (
            <Row
              key={hit.id}
              on={hits.indexOf(hit) === at}
              onHover={() => setAt(hits.indexOf(hit))}
              onPick={() => choose(hit)}
            >
              <span className="truncate type-small">{hit.label}</span>
              <span className="figures ml-auto type-caption text-text-2">
                {count(hit.runs)} runs ·{" "}
                {hit.median === null ? "never answered" : duration(hit.median)}
              </span>
            </Row>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  on,
  onHover,
  onPick,
  children,
}: {
  on: boolean;
  onHover: () => void;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseMove={onHover}
      onClick={onPick}
      aria-selected={on}
      className={cn(
        "move-state flex w-full items-center gap-3 px-4 py-2 text-left",
        on ? "bg-live-wash text-text" : "hover:bg-hover"
      )}
    >
      {children}
    </button>
  );
}
