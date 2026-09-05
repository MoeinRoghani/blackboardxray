/**
 * The canvas, and whatever is stacked over it.
 *
 * The canvas is one element that never unmounts: the runs list and the
 * selected run live in it for the whole session. Layers are pushed over it and
 * the canvas recedes behind them, so an operator three deep on an agent can
 * still see the run they came from and get back with one gesture.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Chrome } from "@/components/Chrome";
import { CommandPalette } from "@/components/CommandPalette";
import { RunList } from "@/components/RunList";
import { Overview } from "@/components/Overview";
import { RunPane } from "@/components/RunPane";
import { AgentSheet, EventSheet, SettingsSheet } from "@/components/sheets";
import { useOverview, useRuns } from "@/lib/api";
import { cn } from "@/lib/cn";
import { KIND_LABEL, type RunEvent } from "@/lib/events";
import { useLayers, type Layer } from "@/lib/layers";

export function App() {
  const { boardId, layers, isClosing, push, pop, openRun } = useLayers();
  const [outcome, setOutcome] = useState("");
  const [palette, setPalette] = useState(false);

  const runs = useRuns(useMemo(() => ({ outcome: outcome || undefined, limit: 100 }), [outcome]));
  const overview = useOverview();

  // The command key with K is the way into search from anywhere, including
  // from inside a layer.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onEvent = useCallback(
    (event: RunEvent) => push({ kind: "event", eventId: event.id }),
    [push]
  );
  const onAgent = useCallback(
    (name: string) => name && push({ kind: "agent", name }),
    [push]
  );

  const stacked = layers.length > 0;

  return (
    <div className="relative h-dvh overflow-hidden bg-canvas">
      {/* The canvas does not move when a layer opens. Scaling it back pushed
          it away from the edges and left a band of the container showing, and
          it took the run the reader was mid-way through reading with it. A
          sheet arriving is not a reason to disturb what is underneath. */}
      <div className="flex h-full flex-col bg-canvas">
        <Chrome
          outcome={outcome}
          onOutcome={setOutcome}
          onSearch={() => setPalette(true)}
          onSettings={() => push({ kind: "settings" })}
          project={overview.data?.project}
          total={overview.data?.runs}
        />

        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              "w-full shrink-0 border-r border-hairline bg-surface",
              "md:w-list",
              boardId && "max-md:hidden"
            )}
          >
            <RunList
              runs={runs.data?.runs ?? []}
              selected={boardId}
              loading={runs.isLoading}
              error={runs.isError ? runs.error : null}
              filtered={Boolean(outcome)}
              onSelect={openRun}
            />
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto">
            {boardId ? (
              <RunPane
                boardId={boardId}
                onEvent={onEvent}
                onAgent={onAgent}
                onBackToList={() => openRun("")}
              />
            ) : (
              <Overview onRun={openRun} onAgent={onAgent} onFilter={setOutcome} />
            )}
          </main>
        </div>
      </div>

      {/* A click-catcher rather than a scrim: clicking the canvas dismisses the
          stack, and the canvas stays fully lit while it does. */}
      {stacked ? (
        <button
          type="button"
          aria-label="Close"
          onClick={() => pop(layers.length)}
          className="absolute inset-0 z-30 cursor-default"
        />
      ) : null}

      {layers.map((layer, index) => (
        <LayerBody
          key={key(layer, index)}
          layer={layer}
          boardId={boardId}
          depth={layers.length - 1 - index}
          closing={isClosing}
          backTo={backLabel(layers, index, boardId)}
          onBack={() => pop(layers.length - index)}
          onAgent={onAgent}
          onRun={(next) => {
            pop(layers.length);
            openRun(next);
          }}
        />
      ))}

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        onRun={openRun}
        onAgent={onAgent}
      />
    </div>
  );
}

function LayerBody({
  layer,
  boardId,
  depth,
  closing,
  backTo,
  onBack,
  onAgent,
  onRun,
}: {
  layer: Layer;
  boardId: string | null;
  depth: number;
  closing: boolean;
  backTo: string;
  onBack: () => void;
  onAgent: (name: string) => void;
  onRun: (boardId: string) => void;
}) {
  if (layer.kind === "settings") {
    return <SettingsSheet depth={depth} closing={closing} onBack={onBack} />;
  }
  if (layer.kind === "agent") {
    return (
      <AgentSheet
        name={layer.name}
        depth={depth}
        closing={closing}
        backTo={backTo}
        onBack={onBack}
        onRun={onRun}
      />
    );
  }
  if (!boardId) return null;
  return (
    <EventSheet
      boardId={boardId}
      eventId={layer.eventId}
      depth={depth}
      closing={closing}
      backTo={backTo}
      onBack={onBack}
      onAgent={onAgent}
    />
  );
}

/** A back control names what it returns to, so it is never a bare arrow. */
function backLabel(layers: Layer[], index: number, boardId: string | null): string {
  const under = layers[index - 1];
  if (!under) return boardId ?? "Runs";
  if (under.kind === "agent") return under.name;
  if (under.kind === "settings") return "Runs";
  return KIND_LABEL["write.admitted"];
}

function key(layer: Layer, index: number): string {
  if (layer.kind === "event") return `e${layer.eventId}-${index}`;
  if (layer.kind === "agent") return `a${layer.name}-${index}`;
  return `s${index}`;
}
