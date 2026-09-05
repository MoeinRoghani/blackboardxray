/**
 * Projects, keys, and what this platform does not do.
 *
 * The last part belongs on a screen rather than only in a document, because a
 * reader deciding whether to put this in front of a network is deciding it
 * here.
 */
import { KeyRound } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { RowSkeleton } from "@/components/Skeleton";
import { EmptyState, ErrorState } from "@/components/States";
import { useHealth, useProjects } from "@/lib/api";
import { count, instant } from "@/lib/format";

export function Settings() {
  const projects = useProjects();
  const health = useHealth();

  return (
    <>
      <PageHeader
        title="Settings"
        meta={
          health.data ? (
            <>
              <span>Platform {health.data.status}</span>
              <span className="numeric">schema {health.data.schema_version}</span>
              <span className="numeric">
                {health.data.kinds.length} event kinds
              </span>
            </>
          ) : null
        }
      />

      <section className="pb-8">
        <h2 className="type-heading pb-3 text-text-primary">Projects</h2>
        {projects.isError ? <ErrorState error={projects.error} /> : null}
        {projects.isLoading ? (
          <div className="rounded-md border border-border-subtle">
            {Array.from({ length: 2 }, (_, index) => (
              <RowSkeleton key={index} columns={2} />
            ))}
          </div>
        ) : null}
        {projects.data && projects.data.projects.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No project exists yet"
            command={"blackboardxray project production\nblackboardxray key production"}
          >
            A project is one deployment sending to this platform, and a key is
            how the platform knows which one is sending.
          </EmptyState>
        ) : null}
        {projects.data && projects.data.projects.length > 0 ? (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {projects.data.projects.map((project) => (
              <li
                key={project.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-3"
              >
                <span className="numeric type-small font-medium text-text-primary">
                  {project.slug}
                </span>
                <span className="type-caption text-text-secondary">
                  {project.name}
                </span>
                <span className="numeric ml-auto type-caption text-text-secondary">
                  {count(project.runs)} runs
                </span>
                <span className="numeric type-caption text-text-secondary">
                  {count(project.keys)} {project.keys === 1 ? "key" : "keys"}
                </span>
                <span className="type-caption text-text-secondary">
                  since {instant(project.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="pb-8">
        <h2 className="type-heading pb-3 text-text-primary">Issuing a key</h2>
        <p className="type-small max-w-prose pb-3 text-text-secondary">
          A key is shown once. The database holds its hash, so the platform can
          check a token it is shown and cannot show one it was given.
        </p>
        <pre className="numeric overflow-x-auto rounded-sm border border-border-subtle bg-surface-sunken p-3 type-caption text-text-primary">
          <code>blackboardxray key production "the name you will recognise"</code>
        </pre>
      </section>

      <section>
        <h2 className="type-heading pb-3 text-text-primary">
          What this platform does not do
        </h2>
        <dl className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          <Limit label="It does not authenticate a reader">
            Ingestion needs a key, because a key is how the platform knows which
            deployment is sending. Reading is open to whoever can reach the
            server. Put it behind whatever already fronts your internal tools.
          </Limit>
          <Limit label="It does not store contributions by default">
            A write records the size and the shape of its content and none of
            the content. A deployment whose contributions are not sensitive
            opts in by passing `content_limit`.
          </Limit>
          <Limit label="It does not read your board">
            Everything here arrived because an application sent it. The platform
            holds no connection to your store and cannot fill a gap left by
            events that were dropped.
          </Limit>
          <Limit label="It does not write to a run">
            There is no control here. It reads.
          </Limit>
        </dl>
      </section>
    </>
  );
}

function Limit({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 p-3">
      <dt className="type-small font-medium text-text-primary">{label}</dt>
      <dd className="type-caption max-w-prose text-text-secondary">{children}</dd>
    </div>
  );
}
