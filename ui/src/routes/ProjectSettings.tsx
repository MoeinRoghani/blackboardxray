/**
 * One project: the keys that write to it, how long it keeps things, and how
 * to be rid of it.
 *
 * A key is shown once, on the row that made it, and then never again. The
 * screen is built around that: the new key takes the top of the list with the
 * value in it, and everything else shows a prefix, which is enough to tell two
 * keys apart and not enough to use one.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Frame } from "@/components/Frame";
import {
  Button,
  Field,
  Input,
  Nothing,
  Panel,
  Refused,
  Row,
  Select,
} from "@/components/Form";
import { Secret } from "@/routes/Gate";
import { cn } from "@/lib/cn";
import { ago, count, instant } from "@/lib/format";
import {
  useConfigureProject,
  useCreateKey,
  useDeleteProject,
  useKeys,
  useProjectMembers,
  useRevokeKey,
  useSetProjectRole,
} from "@/lib/admin";
import { useProjectId } from "@/lib/api";
import { useSession } from "@/lib/session";

export function ProjectSettings() {
  const project = useProjectId();
  const { me } = useSession();
  const here = me?.projects.find((one) => one.id === project);
  const mayManage = here?.role === "owner" || here?.role === "admin";

  return (
    <Frame>
      <div className="scroll-end min-h-0 overflow-y-auto bg-field">
        <div className="mx-auto grid max-w-3xl gap-3 p-4">
          <header>
            <h1 className="type-title">{here?.name ?? "Project"}</h1>
            <p className="measure pt-1 type-small text-text-2">
              {here
                ? `In ${here.org_name}. ${count(here.runs)} runs recorded.`
                : "Loading."}
            </p>
          </header>

          {!mayManage ? (
            <p className="measure rounded-md border border-rule bg-plane px-3 py-3 type-small text-text-2">
              You are {here?.role ?? "not an administrator"} on this project, so
              you can read its runs and not change how it is set up. Ask an
              admin of {here?.org_name ?? "this organization"}.
            </p>
          ) : (
            <>
              <Keys project={project} />
              <Access project={project} mine={here?.role ?? "none"} />
              <Retention project={project} current={here?.retention_days ?? null} />
              <Removal project={project} name={here?.name ?? ""} />
            </>
          )}
        </div>
      </div>
    </Frame>
  );
}

function Keys({ project }: { project: string }) {
  const keys = useKeys(project);
  const create = useCreateKey(project);
  const revoke = useRevokeKey(project);
  const [name, setName] = useState("");
  const [making, setMaking] = useState(false);

  const rows = keys.data?.keys ?? [];

  return (
    <Panel
      title="Keys"
      note="What an application sends with. Each belongs to this project alone."
      action={
        making ? null : (
          <Button onClick={() => setMaking(true)}>
            <Plus size={13} aria-hidden />
            New key
          </Button>
        )
      }
    >
      {making ? (
        <form
          className="grid gap-3 border-b border-hairline bg-plane-2 p-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            create.mutate({ name });
          }}
        >
          <Field label="What is this key for" hint="A name you will recognise later, such as the service that holds it.">
            {(id) => (
              <Input
                id={id}
                autoFocus
                placeholder="payments-ledger"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Refused error={create.error} />
          <div className="flex gap-2">
            <Button type="submit" tone="primary" busy={create.isPending}>
              Create
            </Button>
            <Button
              type="button"
              onClick={() => {
                setMaking(false);
                create.reset();
                setName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {create.isSuccess ? (
        <div className="border-b border-hairline bg-live-wash p-3">
          <p className="type-caption font-medium text-text">
            Copy this now. It is shown once.
          </p>
          <p className="measure pb-2 type-caption text-text-2">
            The platform keeps only a digest of it and cannot show it again. If
            you lose it, revoke it and make another.
          </p>
          <Secret value={create.data.token} />
        </div>
      ) : null}

      {keys.isLoading ? <Nothing>Loading keys.</Nothing> : null}
      {!keys.isLoading && rows.length === 0 ? (
        <Nothing>
          No key yet. An application needs one before it can send anything.
        </Nothing>
      ) : null}

      {rows.map((key) => (
        <Row key={key.id}>
          <span className="flex min-w-0 items-center gap-2">
            <code className="code shrink-0 text-text-2">{key.prefix}…</code>
            <span
              className={cn(
                "truncate type-caption",
                key.disabled_at ? "text-text-2 line-through" : "text-text"
              )}
            >
              {key.name || "unnamed"}
            </span>
            {key.disabled_at ? (
              <span className="chip type-caption shrink-0 py-0">revoked</span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="type-caption figures text-text-2">
              {key.last_used_at ? `used ${ago(key.last_used_at)}` : "never used"}
            </span>
            {key.disabled_at ? null : (
              <Button
                tone="danger"
                onClick={() => revoke.mutate(key.id)}
                busy={revoke.isPending && revoke.variables === key.id}
              >
                Revoke
              </Button>
            )}
          </span>
        </Row>
      ))}
      <Refused error={revoke.error} />
    </Panel>
  );
}

/** How the roles rank, so the control offers only what this person may grant. */
const RANK: Record<string, number> = {
  none: 0,
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

/**
 * Who may read this project, and who reads it differently from the rest.
 *
 * The organization decides by default. A row here overrides it in either
 * direction: it raises somebody to admin on the one project they run, and it
 * is how a person whose organization role is `none` is given exactly this
 * project and nothing else. Clearing the override returns them to whatever the
 * organization says, which is why the choice is "same as the organization"
 * rather than a role that happens to match.
 */
function Access({
  project,
  mine,
}: {
  project: string;
  mine: string;
}) {
  const members = useProjectMembers(project);
  const set = useSetProjectRole(project);
  const rows = members.data?.members ?? [];
  const offerable = Object.keys(RANK).filter((role) =>
    role === "owner" ? mine === "owner" : RANK[mine] > RANK[role]
  );

  return (
    <Panel
      title="Who reads this project"
      note="Everybody in the organization reads it with the role they have there. Give somebody a different one here and it applies to this project only."
    >
      {members.isLoading ? <Nothing>Loading people.</Nothing> : null}
      {!members.isLoading && rows.length === 0 ? (
        <Nothing>Nobody is in this organization yet.</Nothing>
      ) : null}
      {rows.map((member) => (
        <Row key={member.id}>
          <span className="flex min-w-0 flex-col">
            <span className="truncate type-caption text-text">
              {member.name || member.email}
            </span>
            <span className="truncate type-caption text-text-2">
              {member.org_role} in the organization
              {member.project_role ? `, ${member.project_role} here` : ""}
            </span>
          </span>
          <Select
            value={member.project_role ?? ""}
            aria-label={`What ${member.email} reads this project as`}
            onChange={(event: { target: { value: string } }) =>
              set.mutate({ member: member.id, role: event.target.value })
            }
          >
            <option value="">same as the organization</option>
            {offerable.map((role) => (
              <option key={role} value={role}>
                {role} here
              </option>
            ))}
          </Select>
        </Row>
      ))}
      <Refused error={set.error} />
    </Panel>
  );
}

function Retention({
  project,
  current,
}: {
  project: string;
  current: number | null;
}) {
  const configure = useConfigureProject(project);
  const [days, setDays] = useState(current === null ? "" : String(current));

  return (
    <Panel
      title="Retention"
      note="How long a run is kept. Runs older than this are deleted, and what is deleted does not come back."
    >
      <form
        className="grid gap-3 p-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const value = days.trim();
          configure.mutate({ retention_days: value === "" ? null : Number(value) });
        }}
      >
        <Field
          label="Days to keep"
          hint="Leave empty to keep everything for ever, which is what a project does until you decide otherwise."
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={3650}
              placeholder="for ever"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="max-w-xs"
            />
          )}
        </Field>
        <Refused error={configure.error} />
        <div className="flex items-center gap-3">
          <Button type="submit" tone="primary" busy={configure.isPending}>
            Save
          </Button>
          {configure.isSuccess ? (
            <span className="type-caption text-ok" role="status">
              Saved.
            </span>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

function Removal({ project, name }: { project: string; name: string }) {
  const remove = useDeleteProject();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const matches = typed === name && name !== "";

  return (
    <Panel
      title="Delete this project"
      note="Every run, every event and every key recorded under it goes with it. There is no undo."
    >
      <div className="grid gap-3 p-3">
        <Field
          label={`Type ${name} to confirm`}
          hint="Asked for because this is the one action on this screen that cannot be reversed."
        >
          {(id) => (
            <Input
              id={id}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="max-w-xs"
            />
          )}
        </Field>
        <Refused error={remove.error} />
        <div>
          <Button
            tone="danger"
            disabled={!matches}
            busy={remove.isPending}
            onClick={() =>
              remove.mutate(project, { onSuccess: () => navigate("/", { replace: true }) })
            }
          >
            <AlertTriangle size={13} aria-hidden />
            Delete {name}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export { Trash2 };
export { instant };
