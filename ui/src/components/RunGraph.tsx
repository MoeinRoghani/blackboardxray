/**
 * One run, drawn as what wrote to what and who was told.
 *
 * The graph is an aggregate, not a trace. A run carries hundreds of events and
 * drawing an edge per event produces a hairball that answers nothing; drawing
 * one edge per agent and region, weighted by how much crossed it, answers the
 * question the picture is for: where did the work go, and what did not arrive.
 *
 * A network diagram is the least accessible form in the product, so it is
 * never the only copy. The Events view beside it is the same run as a table
 * and is the record; this is a reading of it. Every node here is focusable and
 * carries the same counts in its label that the drawing carries in its weight.
 */
import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { count } from "@/lib/format";
import type { RunEvent } from "@/lib/events";
import type { Run } from "@/lib/api";

/** The drawing's own grid. A viewBox unit, not a pixel: the frame scales it. */
const UNIT = {
  width: 1000,
  agentX: 24,
  agentWidth: 168,
  boardX: 372,
  boardWidth: 604,
  regionInset: 16,
  rowHeight: 34,
  rowGap: 10,
  boardPadTop: 34,
  boardPadBottom: 14,
  top: 16,
};

interface Link {
  agent: string;
  region: string;
  writes: number;
  refused: number;
  conflicted: number;
}

export function RunGraph({
  run,
  events,
  focus,
  onFocus,
}: {
  run: Run;
  events: RunEvent[];
  /** The agent or region the reader is pointing at, if any. */
  focus: string | null;
  onFocus: (name: string | null) => void;
}) {
  const model = useMemo(() => build(run, events), [run, events]);
  const open = run.outcome === null;

  // The frame is derived from both columns, not from whichever has more rows.
  // The board is a box around its regions and is taller than they are, so
  // sizing the drawing by the row count alone cut the last region off.
  const span = (items: number) =>
    items === 0 ? 0 : items * UNIT.rowHeight + (items - 1) * UNIT.rowGap;

  const agentSpan = span(model.agents.length);
  const boardSpan = UNIT.boardPadTop + span(model.regions.length) + UNIT.boardPadBottom;
  const content = Math.max(agentSpan, boardSpan, UNIT.rowHeight * 3);
  const height = content + UNIT.top * 2;

  const agentY = model.agents.map(
    (_, index) =>
      UNIT.top + (content - agentSpan) / 2 + index * (UNIT.rowHeight + UNIT.rowGap)
  );
  const boardTop = UNIT.top + (content - boardSpan) / 2;
  const regionY = model.regions.map(
    (_, index) => boardTop + UNIT.boardPadTop + index * (UNIT.rowHeight + UNIT.rowGap)
  );
  const boardHeight = boardSpan;

  return (
    <div className="relative grid min-h-0 place-items-center overflow-auto p-4">
      <svg
        viewBox={`0 0 ${UNIT.width} ${height}`}
        width={UNIT.width}
        height={height}
        className="h-auto w-full max-w-6xl"
        role="img"
        aria-label={`${model.agents.length} agents and ${model.regions.length} regions on board ${run.board_id}. ${model.links.length} paths carried work. The Events view is the same run as a table.`}
      >
        <defs>
          <marker
            id="bxr-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
          </marker>
        </defs>

        {/* The board is drawn as a container, because that is what it is: the
            regions are inside it and the agents are outside reaching in. */}
        <g className="text-rule">
          <rect
            x={UNIT.boardX}
            y={boardTop}
            width={UNIT.boardWidth}
            height={boardHeight}
            rx="10"
            className="fill-well stroke-current"
            strokeWidth="1"
          />
          <text
            x={UNIT.boardX + UNIT.regionInset}
            y={boardTop + 20}
            className="fill-text-2"
            style={{ fontSize: "var(--text-caption-size)", letterSpacing: "var(--text-label-tracking)" }}
          >
            THE BOARD
          </text>
          <text
            x={UNIT.boardX + UNIT.boardWidth - UNIT.regionInset}
            y={boardTop + 20}
            textAnchor="end"
            className="fill-text-2 figures"
            style={{ fontSize: "var(--text-caption-size)" }}
          >
            {`seq ${count(run.last_sequence)}`}
          </text>
        </g>

        {model.links.map((edge) => {
          const from = model.agents.indexOf(edge.agent);
          const to = model.regions.indexOf(edge.region);
          if (from < 0 || to < 0) return null;
          const dim = focus !== null && focus !== edge.agent && focus !== edge.region;
          return (
            <Edges
              key={`${edge.agent} ${edge.region}`}
              edge={edge}
              y1={agentY[from] + UNIT.rowHeight / 2}
              y2={regionY[to] + UNIT.rowHeight / 2}
              dim={dim}
              live={open}
            />
          );
        })}

        {/* Delivery. A notification carries no values and names no region, so
            there is exactly one of these per agent however many regions it
            reads: the board moved, and this agent was told, or was not. */}
        {model.agents.map((name, index) => {
          const who = model.byAgent[name];
          if (!who || who.told === 0) return null;
          return (
            <Delivery
              key={`told ${name}`}
              y={agentY[index] + UNIT.rowHeight / 2}
              boardY={boardTop + boardHeight / 2}
              failed={who.failed > 0}
              dim={focus !== null && focus !== name}
            />
          );
        })}

        {model.agents.map((name, index) => (
          <Node
            key={name}
            x={UNIT.agentX}
            y={agentY[index]}
            width={UNIT.agentWidth}
            label={name}
            detail={`${count(model.byAgent[name]?.writes ?? 0)} writes`}
            alarm={run.unfinished.includes(name)}
            focused={focus === name}
            dim={
              focus !== null &&
              focus !== name &&
              !model.links.some((l) => l.agent === name && l.region === focus)
            }
            title={`Agent ${name}. ${count(model.byAgent[name]?.writes ?? 0)} writes, ${count(
              model.byAgent[name]?.acked ?? 0
            )} of ${count(model.byAgent[name]?.told ?? 0)} notifications acknowledged${
              run.unfinished.includes(name) ? ", did not finish" : ""
            }.`}
            onFocus={() => onFocus(name)}
            onBlur={() => onFocus(null)}
          />
        ))}

        {model.regions.map((name, index) => {
          const region = run.regions.find((one) => one.name === name);
          return (
            <Node
              key={name}
              x={UNIT.boardX + UNIT.regionInset}
              y={regionY[index]}
              width={UNIT.boardWidth - UNIT.regionInset * 2}
              label={name}
              detail={`${region?.kind ?? "region"}, ${count(model.byRegion[name] ?? 0)} writes`}
              focused={focus === name}
              dim={
                focus !== null &&
                focus !== name &&
                !model.links.some((l) => l.region === name && l.agent === focus)
              }
              inside
              title={`Region ${name}, a ${region?.kind ?? "region"}. ${count(
                model.byRegion[name] ?? 0
              )} writes landed here.`}
              onFocus={() => onFocus(name)}
              onBlur={() => onFocus(null)}
            />
          );
        })}
      </svg>
    </div>
  );
}

/**
 * The paths between one agent and one region.
 *
 * A write is a solid curve into the board, weighted by how much crossed it. A
 * refused or conflicted write is a stub that stops at a barrier before it, so
 * the difference between landing and not landing is a shape and not a hue.
 * Delivery is not drawn here: a notification names no region, so it is one
 * path per agent and is drawn once, beside them.
 */
function Edges({
  edge,
  y1,
  y2,
  dim,
  live,
}: {
  edge: Link;
  y1: number;
  y2: number;
  dim: boolean;
  live: boolean;
}) {
  const x1 = UNIT.agentX + UNIT.agentWidth;
  const x2 = UNIT.boardX;
  const bend = (x2 - x1) * 0.5;
  const out = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
  // A path carrying a hundred writes should not be a hundred times thicker
  // than one carrying one. The root keeps the heaviest legible without the
  // lightest disappearing.
  const weight = Math.min(3.4, 0.9 + Math.sqrt(edge.writes) * 0.42);
  const stub = x1 + bend * 0.55;

  return (
    <g className={cn("move-state", dim && "opacity-15")}>
      {edge.writes > 0 ? (
        <>
          <path
            d={out}
            fill="none"
            strokeWidth={weight}
            className="stroke-live-solid"
            markerEnd="url(#bxr-arrow)"
            opacity="0.75"
          />
          {live ? (
            <circle r="2.6" className="fill-live flow" opacity="0.9">
              <animateMotion dur="2.6s" repeatCount="indefinite" path={out} />
            </circle>
          ) : null}
        </>
      ) : null}

      {edge.refused > 0 || edge.conflicted > 0 ? (
        <g
          className={edge.refused > 0 ? "text-bad-solid" : "text-warn-solid"}
          stroke="currentColor"
        >
          <path
            d={`M ${x1} ${y1 - 9} C ${x1 + bend * 0.5} ${y1 - 9}, ${stub - bend * 0.4} ${y1 - 16}, ${stub} ${y1 - 16}`}
            fill="none"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
          {/* The barrier it stopped at. A refused write produced nothing on
              the board, so the mark ends in something, not in nothing. */}
          <line
            x1={stub + 2}
            y1={y1 - 22}
            x2={stub + 2}
            y2={y1 - 10}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
      ) : null}
    </g>
  );
}

/**
 * What the board told one agent.
 *
 * Drawn under the writes and offset below the agent's own row, so a path out
 * and a path back are never the same line read twice. Where a delivery failed
 * the path is broken and ends in a cross: the agent never learned that the
 * board had moved, which is the one failure nothing else in the run reports.
 */
function Delivery({
  y,
  boardY,
  failed,
  dim,
}: {
  y: number;
  boardY: number;
  failed: boolean;
  dim: boolean;
}) {
  const x1 = UNIT.agentX + UNIT.agentWidth;
  const x2 = UNIT.boardX;
  const bend = (x2 - x1) * 0.5;
  const stop = failed ? x1 + bend * 0.75 : x1;
  const path = `M ${x2} ${boardY} C ${x2 - bend} ${boardY}, ${stop + bend * 0.5} ${y + 9}, ${stop} ${y + 9}`;
  return (
    <g className={cn("move-state", dim && "opacity-15")}>
      <path
        d={path}
        fill="none"
        strokeWidth="1"
        strokeDasharray={failed ? "3 4" : "4 4"}
        className={failed ? "stroke-bad-solid" : "stroke-text-2"}
        opacity={failed ? "0.9" : "0.45"}
      />
      {failed ? (
        <g className="stroke-bad-solid" strokeWidth="1.6" strokeLinecap="round">
          <line x1={stop - 5} y1={y + 4} x2={stop + 5} y2={y + 14} />
          <line x1={stop + 5} y1={y + 4} x2={stop - 5} y2={y + 14} />
        </g>
      ) : null}
    </g>
  );
}

function Node({
  x,
  y,
  width,
  label,
  detail,
  alarm,
  focused,
  dim,
  inside,
  title,
  onFocus,
  onBlur,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  detail: string;
  alarm?: boolean;
  focused: boolean;
  dim: boolean;
  inside?: boolean;
  title: string;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <g
      tabIndex={0}
      role="listitem"
      aria-label={title}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerEnter={onFocus}
      onPointerLeave={onBlur}
      className={cn("move-state", dim && "opacity-30")}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={UNIT.rowHeight}
        rx="7"
        className={cn(
          "stroke-current",
          inside ? "fill-plane-2" : "fill-plane",
          alarm ? "text-warn-edge" : focused ? "text-live-edge" : "text-edge"
        )}
        strokeWidth={focused || alarm ? 1.6 : 1}
      />
      <text x={x + 12} y={y + 15} className="fill-text" style={{ fontSize: "var(--text-small-size)" }}>
        {label}
      </text>
      <text x={x + 12} y={y + 27} className="fill-text-2 figures" style={{ fontSize: "var(--text-caption-size)" }}>
        {detail}
      </text>
      {alarm ? (
        <text
          x={x + width - 12}
          y={y + 21}
          textAnchor="end"
          className="fill-warn"
          style={{ fontSize: "var(--text-caption-size)" }}
        >
          unfinished
        </text>
      ) : null}
    </g>
  );
}

/** Rolls the events up into the adjacency the drawing needs. */
function build(run: Run, events: RunEvent[]) {
  const links = new Map<string, Link>();
  const byAgent: Record<
    string,
    { writes: number; told: number; acked: number; failed: number }
  > = {};
  const byRegion: Record<string, number> = {};
  const agents = new Set<string>(run.agents);
  const regions = run.regions.map((region) => region.name);

  const edgeFor = (agent: string, region: string): Link => {
    const key = `${agent} ${region}`;
    let found = links.get(key);
    if (!found) {
      found = { agent, region, writes: 0, refused: 0, conflicted: 0 };
      links.set(key, found);
    }
    return found;
  };


  for (const event of events) {
    if (event.kind === "agent.registered" && event.agent) {
      agents.add(event.agent);
      byAgent[event.agent] ??= { writes: 0, told: 0, acked: 0, failed: 0 };
    }
    if (!event.agent) continue;
    const who = (byAgent[event.agent] ??= { writes: 0, told: 0, acked: 0, failed: 0 });
    switch (event.kind) {
      case "write.admitted":
      case "premise.set":
        if (event.region) {
          edgeFor(event.agent, event.region).writes += 1;
          byRegion[event.region] = (byRegion[event.region] ?? 0) + 1;
        }
        who.writes += 1;
        break;
      case "write.refused":
        if (event.region) edgeFor(event.agent, event.region).refused += 1;
        break;
      case "write.conflicted":
        if (event.region) edgeFor(event.agent, event.region).conflicted += 1;
        break;
      case "notification.dispatched":
        who.told += 1;
        break;
      case "notification.acknowledged":
        who.acked += 1;
        break;
      case "notification.failed":
        who.failed += 1;
        break;
      default:
        break;
    }
  }

  return {
    agents: [...agents].sort(),
    regions,
    links: [...links.values()].filter(
      (edge) => edge.writes + edge.refused + edge.conflicted > 0
    ),
    byAgent,
    byRegion,
  };
}
