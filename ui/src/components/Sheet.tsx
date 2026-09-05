/**
 * A pushed layer.
 *
 * Enters from the trailing edge on the sheet curve, which is fast off the mark
 * and settles long without overshoot; a full-height plane that bounces reads
 * as a toy rather than as physics. Leaving is the same curve reversed, and the
 * layer stays mounted for its own exit so it animates away instead of
 * vanishing.
 *
 * Every way out is wired: the back control names what it returns to, Escape
 * pops one, and dragging the leading edge tracks the pointer and pops when the
 * drag passes a third of the width or is thrown hard enough.
 */
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** How far a sheet must be dragged, as a fraction of its width, to dismiss. */
const DISMISS_FRACTION = 0.33;
/** Or how fast it must be thrown, in pixels per millisecond. */
const DISMISS_VELOCITY = 0.55;

export function Sheet({
  title,
  backTo,
  depth,
  closing,
  onBack,
  children,
}: {
  title: ReactNode;
  /** What popping this returns to. Named, so back is never a bare arrow. */
  backTo: string;
  /** 0 is the frontmost layer; higher numbers sit further back. */
  depth: number;
  closing: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  const [entered, setEntered] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragging = useRef<{ x: number; t: number } | null>(null);
  const element = useRef<HTMLElement>(null);

  useEffect(() => {
    // One frame at the start position, then release, so the browser has
    // something to animate from.
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (depth !== 0) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onBack();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [depth, onBack]);

  const offscreen = !entered || closing;
  // A layer behind the front one slides partly out of the way and dims, so the
  // reader can see what they came from without it competing.
  const behind = depth > 0;

  function onPointerDown(event: React.PointerEvent) {
    if (depth !== 0) return;
    dragging.current = { x: event.clientX, t: performance.now() };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!dragging.current) return;
    setDrag(Math.max(0, event.clientX - dragging.current.x));
  }

  function onPointerUp(event: React.PointerEvent) {
    const from = dragging.current;
    dragging.current = null;
    if (!from) return;
    const travelled = Math.max(0, event.clientX - from.x);
    const width = element.current?.offsetWidth ?? 1;
    const speed = travelled / Math.max(1, performance.now() - from.t);
    setDrag(0);
    if (travelled > width * DISMISS_FRACTION || speed > DISMISS_VELOCITY) onBack();
  }

  return (
    <section
      ref={element}
      role="dialog"
      aria-label={typeof title === "string" ? title : undefined}
      style={
        drag
          ? { transform: `translateX(${drag}px)`, transition: "none" }
          : undefined
      }
      className={cn(
        "sheet move-sheet absolute inset-y-0 right-0 z-10 flex w-full flex-col",
        "rounded-l-lg sm:w-sheet",
        offscreen && "translate-x-full",
        !offscreen && behind && "-translate-x-sheet-peek opacity-0 sm:opacity-100",
        !offscreen && behind && "brightness-50 saturate-50",
        !offscreen && !behind && "translate-x-0"
      )}
    >
      <span className="grab" aria-hidden />
      <header
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="chrome flex h-chrome shrink-0 touch-pan-y items-center gap-2 px-3"
      >
        <button
          type="button"
          onClick={onBack}
          className="move-state -ml-1 inline-flex items-center gap-0.5 rounded-sm px-1 py-1 type-small text-live hover:opacity-80"
        >
          <ChevronLeft aria-hidden className="size-3.5" />
          {backTo}
        </button>
        <span className="mx-auto truncate type-small font-medium">{title}</span>
        <kbd className="rounded-sm border border-edge px-1 py-0.5 type-caption text-text-2">
          esc
        </kbd>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </div>
    </section>
  );
}

/** A labelled fact inside a sheet. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-hairline px-4 py-3">
      <div className="type-label">{label}</div>
      <div className="pt-1 type-small break-words">{children}</div>
    </div>
  );
}
