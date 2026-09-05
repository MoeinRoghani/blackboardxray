/**
 * The navigation, as a left rail.
 *
 * A rail rather than a top bar, because this product is read on a laptop
 * beside a terminal and vertical space is the scarce axis. Four destinations,
 * flat, in the order `design/objects.md` settled.
 */
import { Activity, Boxes, ListTree, Moon, Settings2, Sun } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";
import { useHealth } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const DESTINATIONS = [
  { to: "/", label: "Overview", icon: Activity, end: true },
  { to: "/runs", label: "Runs", icon: ListTree, end: false },
  { to: "/agents", label: "Agents", icon: Boxes, end: false },
  { to: "/settings", label: "Settings", icon: Settings2, end: false },
];

export function Rail() {
  const [theme, toggle] = useTheme();
  const health = useHealth();
  return (
    <nav
      aria-label="Sections"
      className={cn(
        "z-rail flex shrink-0 border-border-subtle bg-surface-raised",
        // Below md the rail is a header that wraps onto two rows. It does not
        // scroll sideways: a nav the reader has to drag to reach is a nav with
        // items they will never find.
        "w-full flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2",
        "md:sticky md:top-0 md:h-dvh md:w-rail md:flex-col md:flex-nowrap",
        "md:items-stretch md:justify-between md:gap-0 md:border-b-0 md:border-r md:px-3 md:py-4"
      )}
    >
      <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2 md:flex-none md:flex-col md:items-stretch md:gap-4">
        <Wordmark />
        <ul className="flex flex-wrap items-center gap-1 md:flex-col md:items-stretch">
          {DESTINATIONS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-sm px-2 py-1.5 type-small",
                    "transition-colors duration-fast ease-standard",
                    isActive
                      ? "bg-surface-active font-medium text-text-primary"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  )
                }
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:flex-col md:items-stretch md:gap-3">
        <p className="type-caption hidden text-text-secondary md:block">
          {health.data
            ? `Schema ${health.data.schema_version}. ${health.data.kinds.length} event kinds.`
            : health.isError
              ? "The platform is not answering."
              : "Reading the platform."}
        </p>
        <Button
          emphasis="ghost"
          size="sm"
          onClick={toggle}
          aria-label={theme === "dark" ? "Use the light theme" : "Use the dark theme"}
          className="justify-start"
        >
          {theme === "dark" ? (
            <Sun aria-hidden className="size-3.5" />
          ) : (
            <Moon aria-hidden className="size-3.5" />
          )}
          <span className="max-md:sr-only">
            {theme === "dark" ? "Light" : "Dark"}
          </span>
        </Button>
      </div>
    </nav>
  );
}

/**
 * The mark: a sequence of ticks, one taller than the rest.
 *
 * It is the spine, which is what the product is built on, rather than an
 * abstract glyph that could belong to anything.
 */
function Wordmark() {
  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-4 shrink-0 text-brand-solid"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      >
        <path d="M2 2v12" />
        <path d="M5 4.5h4" />
        <path d="M5 8h7" />
        <path d="M5 11.5h4" />
      </svg>
      <span className="type-small font-semibold tracking-tight text-text-primary">
        blackboard<span className="text-brand-text">xray</span>
      </span>
    </div>
  );
}
