/**
 * Settings, as a place rather than as a drawer.
 *
 * It was a panel pushed over the list, which made the one screen an operator
 * arrives at from a bookmark impossible to link to and put connection details
 * behind a gesture. It is a route now: it has an address, it survives a
 * reload, and it can be sent to whoever is standing up the deployment.
 */
import { Frame } from "@/components/Frame";
import { count } from "@/lib/format";
import { EVENT_KINDS } from "@/lib/events";
import { useHealth, useProjects } from "@/lib/api";

export function Settings() {
  const projects = useProjects();
  const health = useHealth();

  return (
    <Frame>
      <div className="min-h-0 overflow-y-auto bg-field scroll-end">
        <div className="mx-auto grid max-w-3xl gap-3 p-4">
          <header>
            <h1 className="type-title">Settings</h1>
            <p className="measure pt-1 type-small text-text-2">
              What this deployment is, and what an application has to do to be seen by it.
            </p>
          </header>

          <Panel title="This platform">
            <Row term="Status" value={health.data?.status ?? (health.isLoading ? "checking" : "unreachable")} />
            <Row term="Schema" value={String(health.data?.schema_version ?? "unknown")} />
            <Row term="Event kinds" value={String(health.data?.kinds.length ?? EVENT_KINDS.length)} />
          </Panel>

          <Panel title="Projects">
            {(projects.data?.projects ?? []).map((project) => (
              <Row
                key={project.id}
                term={project.slug}
                value={`${count(project.runs)} runs, ${count(project.keys)} ${
                  project.keys === 1 ? "key" : "keys"
                }`}
              />
            ))}
            {projects.data?.projects.length === 0 ? (
              <p className="measure px-3 py-2 type-caption text-text-2">
                No project exists yet. Create one with{" "}
                <code className="code">blackboardxray project production</code>.
              </p>
            ) : null}
          </Panel>

          <Panel title="Connecting an application">
            <div className="px-3 py-2">
              <p className="measure pb-2 type-caption text-text-2">
                A key is shown once. The database holds its hash, so the platform can check a
                token it is shown and cannot show one it was given.
              </p>
              <pre className="code overflow-x-auto rounded-sm border border-hairline bg-well p-2">
                <code>{"blackboardxray key production"}</code>
              </pre>
              <p className="measure py-2 type-caption text-text-2">
                Then wrap the model where it is created. The library is not modified and nothing
                else about the application changes.
              </p>
              <pre className="code overflow-x-auto rounded-sm border border-hairline bg-well p-2">
                <code>{SNIPPET}</code>
              </pre>
            </div>
          </Panel>

          <Panel title="What this platform does not do">
            <Limit label="It does not authenticate a reader">
              Ingestion needs a key. Reading is open to whoever can reach the server, so put it
              behind whatever already fronts your internal tools.
            </Limit>
            <Limit label="A contribution is truncated past its limit">
              Content is recorded by default, up to 4kB. Passing content_limit=0 records the size
              and the shape of a contribution and none of its value.
            </Limit>
            <Limit label="A dropped event leaves a hole nothing repairs">
              The sender's queue is bounded, so a platform that is down loses events rather than
              stalling a run. Nothing backfills them afterwards.
            </Limit>
            <Limit label="It never writes to a run">
              Every path here reads. The SDK wraps the control component to watch it, and has no
              route by which an observer could admit a write or close a board.
            </Limit>
          </Panel>
        </div>
      </div>
    </Frame>
  );
}

const SNIPPET = `from blackboardxray import Xray

with Xray(endpoint="http://localhost:8900", token="bxr_...") as xray:
    model = xray.create_model(regions=..., agents=...)`;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-md border border-rule bg-plane">
      <h2 className="type-label border-b border-hairline bg-plane-2 px-3 py-1.5">{title}</h2>
      {children}
    </section>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="row grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-1.5 last:border-b-0">
      <dt className="truncate type-caption text-text">{term}</dt>
      <dd className="figures shrink-0 type-caption text-text-2">{value}</dd>
    </div>
  );
}

function Limit({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row px-3 py-2 last:border-b-0">
      <p className="type-caption font-medium text-text">{label}</p>
      <p className="measure pt-0.5 type-caption text-text-2">{children}</p>
    </div>
  );
}
