/**
 * The canvas, and whatever is stacked over it.
 *
 * Three places, not two: the list, the overview, and a run. Below the two-pane
 * breakpoint the sidebar is the whole screen, so "no run selected" cannot also
 * mean "showing the overview": that laid the overview out in a column of zero
 * width and put all of it off-screen. The overview is its own place and on a
 * phone it replaces the list.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Chrome } from "@/components/Chrome";
import { CommandPalette } from "@/components/CommandPalette";
import { Overview } from "@/components/Overview";
import { RunPane } from "@/components/RunPane";
import { Sidebar } from "@/components/Sidebar";
import { AgentSheet, EventSheet, SettingsSheet } from "@/components/sheets";
import { useOverview, useRuns, useSettled } from "@/lib/api";
import { cn } from "@/lib/cn";
import { KIND_LABEL, type RunEvent } from "@/lib/events";
import { useLayers, type Layer } from "@/lib/layers";

export function App() {
  const {
    boardId,
    overview: atOverview,
    layers,
    isClosing,
    push,
    pop,
    openRun,
    openOverview,
    openList,
  } = useLayers();
  const [outcome, setOutcome] = useState("");
  const [term, setTerm] = useState("");
  const [palette, setPalette] = useState(false);

  const settledTerm = useSettled(term);
  const runs = useRuns(
    useMemo(
      () => ({
        outcome: outcome || undefined,
        search: settledTerm || undefined,
        limit: 100,
      }),
      [outcome, settledTerm]
    )
  );
  const totals = useOverview();

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
    (name: string) => {
      if (name) push({ kind: "agent", name });
    },
    [push]
  );

  const stacked = layers.length > 0;
  const openEventId =
    layers.length && layers[layers.length - 1].kind === "event"
      ? (layers[layers.length - 1] as { eventId: number }).eventId
      : null;
  // On a phone one place owns the screen. On a laptop the sidebar is always up.
  const paneShowing = Boolean(boardId) || atOverview;

  return (
    <div className="relative h-dvh overflow-hidden bg-canvas">
      <a href="#content" className="skip-link type-small">
        Skip to content
      </a>
      <div className="flex h-full flex-col" inert={stacked || undefined}>
        <Chrome
          onSettings={() => push({ kind: "settings" })}
          project={totals.data?.project}
          runs={totals.data?.runs}
        />

        <div className="flex min-h-0 flex-1">
          <aside
            className={cn(
              "shrink-0 border-r border-hairline",
              "w-full md:w-list",
              paneShowing && "max-md:hidden"
            )}
          >
            <Sidebar
              runs={runs.data?.runs ?? []}
              selected={boardId}
              onOverview={openOverview}
              atOverview={atOverview}
              needsAttention={totals.data?.with_unfinished ?? 0}
              loading={runs.isLoading}
              error={runs.isError ? runs.error : null}
              outcome={outcome}
              onOutcome={setOutcome}
              term={term}
              onTerm={setTerm}
              onSelect={openRun}
            />
          </aside>

          <main
            id="content"
            className={cn(
              "min-w-0 flex-1 overflow-y-auto",
              !paneShowing && "max-md:hidden"
            )}
          >
            {boardId ? (
              <RunPane
                boardId={boardId}
                openEventId={openEventId}
                onEvent={onEvent}
                onAgent={onAgent}
                onBackToList={openList}
              />
            ) : (
              <Overview
                onRun={openRun}
                onAgent={onAgent}
                onFilter={setOutcome}
                onBackToList={openList}
              />
            )}
          </main>
        </div>
      </div>

      {/* A click-catcher, not a control. It carries no accessible name and is
          not in the tab order: it was one full-viewport tab stop. Escape and
          the sheet's own back control are the keyboard routes out. */}
      {stacked ? (
        <div
          aria-hidden
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
  if (!under) return boardId ?? "Overview";
  if (under.kind === "agent") return under.name;
  if (under.kind === "settings") return "Overview";
  return KIND_LABEL["write.admitted"];
}

function key(layer: Layer, index: number): string {
  if (layer.kind === "event") return `e${layer.eventId}-${index}`;
  if (layer.kind === "agent") return `a${layer.name}-${index}`;
  return `s${index}`;
}
