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
import { Link, NavLink, useParams } from "react-router-dom";
import {
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  Moon,
  Plus,
  Settings,
  Sun,
  User,
} from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn";
import { count } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import { useHealth, useOverview } from "@/lib/api";
import { useSession, useSignOut } from "@/lib/session";

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
  const { projectId } = useParams();
  const base = projectId ? `/p/${projectId}` : "/";
  return (
    <header className="band band-under flex min-h-bar flex-wrap items-stretch gap-3 pr-2 pl-3 max-md:pb-2">
      <Link
        to={base}
        className="flex items-center gap-2 self-center rounded-sm pr-1 text-text"
        aria-label="blackboardxray, go to boards"
      >
        <Mark />
        <span className="type-small font-medium tracking-tight max-sm:hidden">
          blackboard<span className="text-text-2">xray</span>
        </span>
      </Link>

      <Switcher />

      <nav aria-label="Sections" className="flex items-stretch">
        <Tab to={base}>Boards</Tab>
        <Tab to={`${base}/agents`}>Agents</Tab>
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
          to={`${base}/settings`}
          className={({ isActive }) =>
            cn(
              "move-state flex size-target items-center justify-center rounded-sm text-text-2 hover:bg-hover hover:text-text",
              isActive && "bg-active text-text"
            )
          }
          aria-label="Project settings"
        >
          <Settings size={14} aria-hidden />
        </NavLink>
        <Account />
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

/**
 * Which project is on screen, and how to reach another.
 *
 * Grouped by organization, because a project's name is only unique inside one
 * and two teams may both have called theirs production. The organization's own
 * settings hang off its heading, which is the only place they are reachable
 * from and the place somebody looks for them.
 */
function Switcher() {
  const { me } = useSession();
  const { projectId } = useParams();
  const here = me?.projects.find((one) => one.id === projectId);
  const organizations = me?.organizations ?? [];
  const projects = me?.projects ?? [];

  if (!me) return null;

  return (
    <Menu.Root>
      <Menu.Trigger
        className="move-state flex items-center gap-1.5 self-center rounded-sm border border-edge bg-plane px-2 py-1 type-caption text-text hover:bg-hover"
        aria-label="Change project"
      >
        <span className="max-w-40 truncate">{here?.name ?? "Choose a project"}</span>
        <ChevronsUpDown size={12} aria-hidden className="shrink-0 text-text-2" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={6}
          className="rise z-50 max-h-96 min-w-64 overflow-y-auto rounded-md border border-rule bg-plane p-1 shadow-lg"
        >
          {organizations.map((org) => (
            <Menu.Group key={org.id}>
              <Menu.Label className="flex items-center justify-between gap-2 px-2 pt-2 pb-1 type-label">
                <span className="truncate">{org.name}</span>
                <Link
                  to={`/orgs/${org.id}/settings`}
                  className="shrink-0 normal-case text-text-2 hover:text-text"
                  aria-label={`Settings for ${org.name}`}
                >
                  <Building2 size={12} aria-hidden />
                </Link>
              </Menu.Label>
              {projects
                .filter((one) => one.org_id === org.id)
                .map((one) => (
                  <Menu.Item key={one.id} asChild>
                    <Link
                      to={`/p/${one.id}`}
                      className={cn(
                        "move-state flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 type-caption text-text outline-none",
                        "data-[highlighted]:bg-hover"
                      )}
                    >
                      <Check
                        size={12}
                        aria-hidden
                        className={cn("shrink-0", one.id === projectId ? "text-live" : "opacity-0")}
                      />
                      <span className="min-w-0 flex-1 truncate">{one.name}</span>
                      <span className="shrink-0 type-caption text-text-2">{one.role}</span>
                    </Link>
                  </Menu.Item>
                ))}
              {projects.filter((one) => one.org_id === org.id).length === 0 ? (
                <p className="px-2 pb-1 type-caption text-text-2">No project yet.</p>
              ) : null}
            </Menu.Group>
          ))}
          <Menu.Separator className="my-1 h-px bg-hairline" />
          <Menu.Item asChild>
            <Link
              to="/orgs/new"
              className="move-state flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 type-caption text-text-2 outline-none data-[highlighted]:bg-hover data-[highlighted]:text-text"
            >
              <Plus size={12} aria-hidden />
              New organization
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Account() {
  const { me } = useSession();
  const signOut = useSignOut();
  if (!me) return null;
  const label = me.user.name || me.user.email;
  return (
    <Menu.Root>
      <Menu.Trigger
        className="move-state flex size-target items-center justify-center rounded-sm text-text-2 hover:bg-hover hover:text-text"
        aria-label={`Account: ${label}`}
      >
        <User size={14} aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="rise z-50 min-w-56 rounded-md border border-rule bg-plane p-1 shadow-lg"
        >
          <div className="border-b border-hairline px-2 py-2">
            <p className="truncate type-caption text-text">{label}</p>
            {me.user.name ? (
              <p className="truncate type-caption text-text-2">{me.user.email}</p>
            ) : null}
          </div>
          <Menu.Item asChild>
            <Link
              to="/account"
              className="move-state flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 type-caption text-text outline-none data-[highlighted]:bg-hover"
            >
              <User size={12} aria-hidden />
              Your account
            </Link>
          </Menu.Item>
          <Menu.Item asChild>
            <Link
              to="/platform"
              className="move-state flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 type-caption text-text outline-none data-[highlighted]:bg-hover"
            >
              <Settings size={12} aria-hidden />
              About this deployment
            </Link>
          </Menu.Item>
          <Menu.Item
            onSelect={() => signOut.mutate()}
            className="move-state flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 type-caption text-text outline-none data-[highlighted]:bg-hover"
          >
            <LogOut size={12} aria-hidden />
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
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
  const { projectId } = useParams();
  const totals = useOverview();
  const reachable = health.isSuccess;
  // Off a project there is nothing to count. Reading the project scoped query
  // anyway answered a 404, and the bar said "no project, 0 runs, 0 writes",
  // which reads as the platform having lost them.
  const counted = Boolean(projectId) && totals.isSuccess;
  return (
    <footer className="band band-over flex h-status items-center gap-3 px-3 type-caption text-text-2">
      <span className="flex items-center gap-1.5 text-text-2">
        <span
          className={cn("size-1.5 rounded-full", reachable ? "bg-ok-solid" : "bg-bad-solid")}
          aria-hidden
        />
        {health.isLoading ? "connecting" : reachable ? "connected" : "unreachable"}
      </span>
      {counted ? (
        <>
          <Divider />
          <span>{totals.data?.project}</span>
          <Divider />
          <span className="figures">{count(totals.data?.runs)} runs</span>
          <Divider />
          <span className="figures max-sm:hidden">
            {count(totals.data?.writes)} writes
          </span>
        </>
      ) : null}
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
