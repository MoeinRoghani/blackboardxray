/**
 * The one bar. There is no menu under it.
 *
 * The four destinations this replaced were not siblings: this product has one
 * object, the run, and agents and totals are lenses on it. So the header holds
 * what changes the canvas, and everything else is a layer over it.
 */
import { Moon, Search, Settings2, Sun } from "lucide-react";
import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";

const FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "settled", label: "Settled" },
  { value: "wall_clock_expired", label: "Expired" },
  { value: "aborted", label: "Aborted" },
];

export function Chrome({
  outcome,
  onOutcome,
  onSearch,
  onSettings,
  project,
  total,
}: {
  outcome: string;
  onOutcome: (value: string) => void;
  onSearch: () => void;
  onSettings: () => void;
  project?: string;
  total?: number;
}) {
  const [theme, toggle] = useTheme();
  return (
    <header className="chrome sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:h-chrome sm:flex-nowrap sm:gap-x-4 sm:py-0 sm:pl-4 sm:pr-3">
      <Wordmark />

      <button
        type="button"
        onClick={onSearch}
        className={cn(
          "move-state group hidden h-7 items-center gap-2 rounded-sm px-2 sm:flex",
          "border border-edge bg-surface-2 text-text-2 hover:border-edge-strong hover:text-text"
        )}
      >
        <Search aria-hidden className="size-3.5" />
        <span className="type-caption">Search runs and agents</span>
        <kbd className="ml-6 rounded-sm border border-edge px-1 type-caption">⌘K</kbd>
      </button>

      <div
        role="tablist"
        aria-label="Filter runs by outcome"
        className={cn(
          "flex items-center gap-0.5 rounded-sm border border-edge bg-surface-2 p-0.5",
          // Below sm the filters take their own row rather than competing with
          // the wordmark for a width neither of them fits in.
          "order-last w-full overflow-x-auto sm:order-none sm:ml-auto sm:w-auto"
        )}
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            role="tab"
            aria-selected={outcome === filter.value}
            onClick={() => onOutcome(filter.value)}
            className={cn(
              "move-state shrink-0 rounded-sm px-2 py-1 type-caption",
              outcome === filter.value
                ? "bg-active font-medium text-text"
                : "text-text-2 hover:text-text"
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {project ? (
        <span className="chip hidden type-caption lg:inline-flex">
          {project}
          {total !== undefined ? (
            <span className="figures opacity-70">{total}</span>
          ) : null}
        </span>
      ) : null}

      <Button
        emphasis="quiet"
        size="sm"
        className="ml-auto sm:ml-0"
        onClick={toggle}
        aria-label={theme === "dark" ? "Use the light theme" : "Use the dark theme"}
      >
        {theme === "dark" ? (
          <Sun aria-hidden className="size-3.5" />
        ) : (
          <Moon aria-hidden className="size-3.5" />
        )}
      </Button>
      <Button emphasis="quiet" size="sm" onClick={onSettings} aria-label="Settings">
        <Settings2 aria-hidden className="size-3.5" />
      </Button>
    </header>
  );
}

/** Four rules and a mark on one of them: a board, and something written to it. */
function Wordmark() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-4 text-text"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      >
        <path d="M2.4 2.8v10.4" />
        <path d="M5.4 4.8h8.2" />
        <path d="M5.4 8h8.2" />
        <path d="M5.4 11.2h8.2" />
        <circle cx="9.4" cy="8" r="1.5" fill="currentColor" stroke="none" />
      </svg>
      <span className="type-small font-semibold tracking-tight">
        blackboard<span className="text-text-2">xray</span>
      </span>
    </div>
  );
}
