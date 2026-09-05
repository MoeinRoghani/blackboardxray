/**
 * The layer stack, derived from the URL.
 *
 * The canvas is where you are and layers are what you are inspecting, so the
 * canvas is one route and everything on top of it is a suffix of that route.
 * Deriving the stack from the location rather than from component state buys
 * three things for free: the browser's own back button pops a layer, every
 * depth is a link somebody can paste, and a reload puts the reader back
 * exactly where they were.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type Layer =
  | { kind: "event"; eventId: number }
  | { kind: "agent"; name: string }
  | { kind: "settings" };

export interface Place {
  /** The run the canvas is showing, if any. */
  boardId: string | null;
  /** What is stacked over it, nearest last. */
  layers: Layer[];
}

/**
 * Three deep and no further.
 *
 * Past three the receded canvas stops being readable, and nothing in this
 * domain legitimately nests four deep: a run holds events, an event names one
 * agent, and an agent's runs return you to the canvas rather than deeper.
 */
export const MAX_DEPTH = 3;

export function readPlace(pathname: string): Place {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const place: Place = { boardId: null, layers: [] };
  let at = 0;
  if (parts[at] === "settings") {
    place.layers.push({ kind: "settings" });
    return place;
  }
  if (parts[at] === "r" && parts[at + 1]) {
    place.boardId = parts[at + 1];
    at += 2;
  }
  while (at < parts.length && place.layers.length < MAX_DEPTH) {
    const key = parts[at];
    const value = parts[at + 1];
    if (key === "e" && value && /^\d+$/.test(value)) {
      place.layers.push({ kind: "event", eventId: Number(value) });
    } else if (key === "a" && value) {
      place.layers.push({ kind: "agent", name: value });
    } else {
      break;
    }
    at += 2;
  }
  return place;
}

export function writePlace(place: Place): string {
  const parts: string[] = [];
  if (place.layers[0]?.kind === "settings") return "/settings";
  if (place.boardId) parts.push("r", encodeURIComponent(place.boardId));
  for (const layer of place.layers) {
    if (layer.kind === "event") parts.push("e", String(layer.eventId));
    if (layer.kind === "agent") parts.push("a", encodeURIComponent(layer.name));
  }
  return "/" + parts.join("/");
}

/** How long a sheet takes to leave, read from the token rather than guessed. */
function exitDuration(): number {
  const root = getComputedStyle(document.documentElement);
  const named = root.getPropertyValue("--duration-sheet").trim();
  const parsed = parseFloat(named);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The stack, and the two ways it changes.
 *
 * A layer being dismissed stays mounted for the length of its exit so it can
 * animate off rather than vanish. Popping twice quickly is safe: the second
 * pop finds the first already closing and takes the whole stack with it.
 */
export function useLayers() {
  const location = useLocation();
  const navigate = useNavigate();
  const place = readPlace(location.pathname);
  const [closing, setClosing] = useState<Layer[] | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    // A forward navigation cancels any exit in flight, so a layer opened while
    // another was closing does not inherit the closing state.
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setClosing(null);
  }, [location.pathname]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const push = useCallback(
    (layer: Layer) => {
      const next = readPlace(location.pathname);
      if (next.layers.length >= MAX_DEPTH) next.layers.pop();
      next.layers.push(layer);
      navigate(writePlace(next));
    },
    [location.pathname, navigate]
  );

  const pop = useCallback(
    (to = 1) => {
      const current = readPlace(location.pathname);
      if (!current.layers.length) return;
      const next: Place = {
        boardId: current.boardId,
        layers: current.layers.slice(0, Math.max(0, current.layers.length - to)),
      };
      setClosing(current.layers);
      const wait = exitDuration();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        navigate(writePlace(next));
      }, wait);
    },
    [location.pathname, navigate]
  );

  const openRun = useCallback(
    // An empty identifier means the canvas with nothing selected, which is
    // what going back to the list is below the two-pane breakpoint.
    (boardId: string) => navigate(writePlace({ boardId: boardId || null, layers: [] })),
    [navigate]
  );

  return {
    boardId: place.boardId,
    layers: closing ?? place.layers,
    isClosing: closing !== null,
    push,
    pop,
    openRun,
  };
}
