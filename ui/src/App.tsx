/**
 * Where each address goes, and who is allowed through.
 *
 * One decision comes before every route: has this install been set up, and is
 * anybody signed in. Everything waits on that answer, because drawing the
 * boards for half a second and then replacing them with a sign in page is
 * worse than drawing nothing for half a second.
 *
 * A project is in the path. It has to be: a slug is only unique inside its
 * organization now, and a person with three projects wants three links rather
 * than one link and a remembered selection.
 */
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Account } from "@/routes/Account";
import { Agents } from "@/routes/Agents";
import { Board } from "@/routes/Board";
import { Boards } from "@/routes/Boards";
import { FirstRun, Join, SignIn } from "@/routes/Gate";
import { NewOrganization, OrgSettings } from "@/routes/OrgSettings";
import { Platform } from "@/routes/Platform";
import { ProjectSettings } from "@/routes/ProjectSettings";
import { useSession } from "@/lib/session";

export function App() {
  return (
    <Routes>
      {/* Reachable without a session. Each redirects away when it does not
          apply, so there is no way to sit on a sign in page while signed in. */}
      <Route path="/signin" element={<SignIn />} />
      <Route path="/setup" element={<FirstRun />} />
      <Route path="/join/:token" element={<Join />} />

      <Route element={<Inside />}>
        <Route path="/" element={<Landing />} />
        <Route path="/p/:projectId" element={<Boards />} />
        <Route path="/p/:projectId/boards/:boardId" element={<Board />} />
        <Route path="/p/:projectId/agents" element={<Agents />} />
        <Route path="/p/:projectId/settings" element={<ProjectSettings />} />
        <Route path="/orgs/new" element={<NewOrganization />} />
        <Route path="/orgs/:orgId/settings" element={<OrgSettings />} />
        <Route path="/account" element={<Account />} />
        <Route path="/platform" element={<Platform />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * The gate.
 *
 * Renders nothing until the platform has said what state it is in, then either
 * the routes inside or the way to get inside. The redirect carries where the
 * reader was going, so signing in lands them there rather than at the top.
 */
function Inside() {
  const { state, loading } = useSession();
  const location = useLocation();

  if (loading || !state) return <Waiting />;
  if (state.needs_setup) return <Navigate to="/setup" replace />;
  if (!state.user) {
    return (
      <Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />
    );
  }
  return <Outlet />;
}

/**
 * Where `/` goes, which depends on what this person can reach.
 *
 * One project is the common case and it goes straight there. Several is a
 * choice, and none means somebody is in an organization that has no project
 * yet, which is a thing to fix rather than an empty screen to stare at.
 */
function Landing() {
  const { me } = useSession();
  if (!me) return <Waiting />;
  const [first] = me.projects;
  if (first) return <Navigate to={`/p/${first.id}`} replace />;
  const [organization] = me.organizations;
  if (organization) {
    return <Navigate to={`/orgs/${organization.id}/settings`} replace />;
  }
  return <Nowhere />;
}

function Waiting() {
  return (
    <div className="grid min-h-dvh place-items-center bg-void">
      <p className="type-small text-text-2" role="status">
        Loading.
      </p>
    </div>
  );
}

function Nowhere() {
  return (
    <div className="grid min-h-dvh place-items-center bg-void p-4">
      <div className="max-w-sm rounded-md border border-rule bg-plane p-4">
        <h1 className="type-heading text-text">Nothing to show you yet</h1>
        <p className="measure pt-1 type-small text-text-2">
          Your account is not in any organization. Ask whoever runs this
          platform for an invitation, and the link they send will put you in
          one.
        </p>
      </div>
    </div>
  );
}
