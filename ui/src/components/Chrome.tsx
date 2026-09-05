/**
 * The global bar holds only what is global.
 *
 * Search and the outcome filters used to live here, which put them as far from
 * the column they act on as the screen allows: a filter at x=1100 governing a
 * list that ends at x=300. They now sit in the sidebar, directly above what
 * they filter. What is left here is identity, project, theme and settings.
 *
 * The wordmark is the way home, which is the convention every operator already
 * has and which this product previously did not offer at all.
 */
import { Moon, Settings2, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/Button";
import { useTheme } from "@/lib/theme";

export function Chrome({
  onSettings,
  project,
  runs,
}: {
  onSettings: () => void;
  project?: string;
  runs?: number;
}) {
  const [theme, toggle] = useTheme();
  return (
    <header className="chrome z-20 flex h-chrome shrink-0 items-center gap-3 px-3">
      <Link
        to="/"
        aria-label="blackboardxray, go to the overview"
        className="move-state flex shrink-0 items-center gap-2 rounded-sm px-1 py-1 hover:bg-hover"
      >
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
      </Link>

      {project ? (
        <span className="chip ml-auto type-caption">
          {project}
          {runs !== undefined ? (
            <span className="figures opacity-70">{runs}</span>
          ) : null}
        </span>
      ) : (
        <span className="ml-auto" />
      )}

      <Button
        emphasis="quiet"
        size="sm"
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
