/**
 * The frame every surface is built inside.
 *
 * Three fixed bands and one scrolling region: a bar welded to the top, a
 * status line welded to the bottom, and whatever the surface puts between
 * them. Nothing floats on a ground and there is no outer margin, because an
 * instrument is the window, not a document displayed in one.
 *
 * The bands are `position: static` inside a grid rather than fixed, so the
 * scrolling region is genuinely the only thing that scrolls and no content
 * ever passes under a bar.
 */
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { Moon, Settings, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { count } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useHealth, useOverview } from "@/lib/api";

export function Frame({
  children,
  search,
  window: windowControl,
}: {
  children: ReactNode;
  /** The surface's own search control, where it has one. */
  search?: ReactNode;
  /** The surface's own range control, where it has one. */
  window?: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-void">
      <a href="#content" className="skip-link type-small">
        Skip to content
      </a>
      <TopBar search={search} window={windowControl} />
      <main id="content" className="grid min-h-0 grid-rows-[minmax(0,1fr)]">
        {children}
      </main>
      <StatusBar />
    </div>
  );
}

function TopBar({ search, window: windowControl }: { search?: ReactNode; window?: ReactNode }) {
  const [theme, toggle] = useTheme();
  return (
    <header className="band band-under flex min-h-bar flex-wrap items-stretch gap-3 pr-2 pl-3 max-md:pb-2">
      <Link
        to="/"
        className="flex items-center gap-2 self-center rounded-sm pr-1 text-text"
        aria-label="blackboardxray, go to boards"
      >
        <Mark />
        <span className="type-small font-medium tracking-tight max-sm:hidden">
          blackboard<span className="text-text-2">xray</span>
        </span>
      </Link>

      <nav aria-label="Sections" className="flex items-stretch">
        <Tab to="/">Boards</Tab>
        <Tab to="/agents">Agents</Tab>
      </nav>

      {search ? (
        <div className="flex flex-1 items-center max-md:order-last max-md:w-full max-md:flex-none">
          {search}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <div className="flex items-center gap-1">
        {windowControl}
        <IconButton onClick={toggle} label={theme === "dark" ? "Use the light theme" : "Use the dark theme"}>
          {theme === "dark" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
        </IconButton>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              "move-state flex size-target items-center justify-center rounded-sm text-text-2 hover:bg-hover hover:text-text",
              isActive && "bg-active text-text"
            )
          }
          aria-label="Settings"
        >
          <Settings size={14} aria-hidden />
        </NavLink>
      </div>
    </header>
  );
}

function Tab({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "move-state relative flex items-center px-3 type-small text-text-2 hover:text-text",
          isActive && "text-text after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-live-solid"
        )
      }
    >
      {children}
    </NavLink>
  );
}

export function IconButton({
  onClick,
  label,
  children,
  pressed,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        "move-state flex size-target items-center justify-center rounded-sm text-text-2 hover:bg-hover hover:text-text",
        pressed && "bg-active text-text"
      )}
    >
      {children}
    </button>
  );
}

/**
 * The status line.
 *
 * What an operator checks without asking: which project, how much is in it,
 * and whether the platform itself is answering. It is welded to the bottom
 * edge because an instrument's readout is part of the instrument.
 */
function StatusBar() {
  const health = useHealth();
  const totals = useOverview();
  const reachable = health.isSuccess;
  return (
    <footer className="band band-over flex h-status items-center gap-3 px-3 type-caption text-text-2">
      <span className="flex items-center gap-1.5 text-text-2">
        <span
          className={cn("size-1.5 rounded-full", reachable ? "bg-ok-solid" : "bg-bad-solid")}
          aria-hidden
        />
        {health.isLoading ? "connecting" : reachable ? "connected" : "unreachable"}
      </span>
      <Divider />
      <span>{totals.data?.project ?? "no project"}</span>
      <Divider />
      <span className="figures">{count(totals.data?.runs)} runs</span>
      <Divider />
      <span className="figures max-sm:hidden">{count(totals.data?.writes)} writes</span>
      <span className="flex-1" />
      <span className="figures max-sm:hidden">schema {health.data?.schema_version ?? "unknown"}</span>
    </footer>
  );
}

function Divider() {
  return <span aria-hidden className="h-2.5 w-px bg-hairline" />;
}

/** The mark: a board, and the sequence cutting across it. */
function Mark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="text-live-solid">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <path d="M1.5 9.5h4l2-4 2.5 6 2-2h2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
