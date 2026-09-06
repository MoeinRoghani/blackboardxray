/**
 * One organization: who is in it, what they may do, and who has been asked.
 *
 * An invitation is a link, not an email. The screen that makes one hands it
 * back to be copied, because this platform has no mail server and asking every
 * self hoster to configure one before a second person can sign in is how an
 * install stays a single person's install.
 *
 * The role control refuses in the interface what the server refuses anyway: an
 * admin cannot offer ownership. Both, because the server is the one that
 * matters and a control that offers a choice then rejects it is a control that
 * lied.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Plus } from "lucide-react";
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
import { ago } from "@/lib/format";
import {
  useCreateInvite,
  useCreateOrganization,
  useCreateProject,
  useDeleteOrganization,
  useInvites,
  useMembers,
  useRemoveMember,
  useRenameOrganization,
  useRevokeInvite,
  useSetMemberRole,
} from "@/lib/admin";
import { useSession } from "@/lib/session";

/** How the roles rank, so the interface can offer only what it may grant. */
const RANK: Record<string, number> = {
  none: 0,
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

const DESCRIBED: Record<string, string> = {
  owner: "Everything, including deleting this organization.",
  admin: "Projects, keys and people. Cannot touch owners.",
  member: "Reads every run, including what was written.",
  viewer: "Reads what happened, and not what was written.",
  none: "Nothing here. Give them a project instead.",
};

function grantable(mine: string): string[] {
  return Object.keys(RANK).filter((role) =>
    role === "owner" ? mine === "owner" : RANK[mine] > RANK[role]
  );
}

export function OrgSettings() {
  const { orgId = "" } = useParams();
  const { me } = useSession();
  const here = me?.organizations.find((one) => one.id === orgId);
  const mine = here?.role ?? "none";
  const mayManage = mine === "owner" || mine === "admin";

  return (
    <Frame>
      <div className="scroll-end min-h-0 overflow-y-auto bg-field">
        <div className="mx-auto grid max-w-3xl gap-3 p-4">
          <header>
            <h1 className="type-title">{here?.name ?? "Organization"}</h1>
            <p className="measure pt-1 type-small text-text-2">
              You are {mine} here.
            </p>
          </header>

          <Members org={orgId} mine={mine} mayManage={mayManage} />
          {mayManage ? <Invites org={orgId} mine={mine} /> : null}
          {mayManage ? <Projects org={orgId} /> : null}
          {mayManage ? <Naming org={orgId} name={here?.name ?? ""} /> : null}
          {mine === "owner" ? (
            <Removal org={orgId} name={here?.name ?? ""} />
          ) : null}
        </div>
      </div>
    </Frame>
  );
}

function Members({
  org,
  mine,
  mayManage,
}: {
  org: string;
  mine: string;
  mayManage: boolean;
}) {
  const members = useMembers(org);
  const setRole = useSetMemberRole(org);
  const remove = useRemoveMember(org);
  const { me } = useSession();
  const rows = members.data?.members ?? [];
  const offerable = grantable(mine);

  return (
    <Panel title="People" note="Everybody who can reach this organization's projects.">
      {members.isLoading ? <Nothing>Loading people.</Nothing> : null}
      {rows.map((member) => {
        const isMe = member.id === me?.user.id;
        // Somebody at or above your own rank is not yours to change.
        const mayTouch = mayManage && RANK[mine] > RANK[member.role];
        return (
          <Row key={member.id}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate type-caption text-text">
                {member.name || member.email}
                {isMe ? <span className="text-text-2"> (you)</span> : null}
              </span>
              <span className="truncate type-caption text-text-2">
                {member.name ? member.email : ""}
                {member.last_seen_at ? ` · seen ${ago(member.last_seen_at)}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {mayTouch ? (
                <Select
                  value={member.role}
                  aria-label={`Role for ${member.email}`}
                  onChange={(event: { target: { value: string } }) =>
                    setRole.mutate({ member: member.id, role: event.target.value })
                  }
                >
                  {[member.role, ...offerable.filter((one) => one !== member.role)].map(
                    (role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    )
                  )}
                </Select>
              ) : (
                <span className="chip type-caption">{member.role}</span>
              )}
              {mayTouch || isMe ? (
                <Button
                  tone="danger"
                  onClick={() => remove.mutate(member.id)}
                  busy={remove.isPending && remove.variables === member.id}
                >
                  {isMe ? "Leave" : "Remove"}
                </Button>
              ) : null}
            </span>
          </Row>
        );
      })}
      <Refused error={setRole.error ?? remove.error} />
      {mayManage ? (
        <dl className="grid gap-1 border-t border-hairline px-3 py-2">
          {Object.entries(DESCRIBED)
            .filter(([role]) => offerable.includes(role))
            .map(([role, what]) => (
              <div key={role} className="grid grid-cols-[var(--column-count)_minmax(0,1fr)] gap-2">
                <dt className="type-caption text-text">{role}</dt>
                <dd className="type-caption text-text-2">{what}</dd>
              </div>
            ))}
        </dl>
      ) : null}
    </Panel>
  );
}

function Invites({ org, mine }: { org: string; mine: string }) {
  const invites = useInvites(org);
  const create = useCreateInvite(org);
  const revoke = useRevokeInvite(org);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const rows = invites.data?.invites ?? [];
  const offerable = grantable(mine);

  return (
    <Panel
      title="Invitations"
      note="Each is a one time link. Send it however you already talk to the person; this platform has no mail server."
    >
      <form
        className="grid items-end gap-2 border-b border-hairline p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.mutate({ email, role });
        }}
      >
        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              required
              placeholder="colleague@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field label="Role">
          {(id) => (
            <Select
              id={id}
              value={role}
              onChange={(event: { target: { value: string } }) =>
                setRole(event.target.value)
              }
            >
              {offerable
                .filter((one) => one !== "none")
                .map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Button type="submit" tone="primary" busy={create.isPending}>
          <Plus size={13} aria-hidden />
          Create invite
        </Button>
      </form>

      {create.isSuccess ? (
        <div className="border-b border-hairline bg-live-wash p-3">
          <p className="type-caption font-medium text-text">
            Send this link to {create.data.email}. It works once.
          </p>
          <p className="measure pb-2 type-caption text-text-2">
            It expires in seven days and is shown once, here.
          </p>
          <Secret value={`${window.location.origin}/join/${create.data.token}`} />
        </div>
      ) : null}

      <Refused error={create.error} />
      {rows.length === 0 && !create.isSuccess ? (
        <Nothing>Nobody is waiting on an invitation.</Nothing>
      ) : null}
      {rows.map((invite) => (
        <Row key={invite.id}>
          <span className="min-w-0">
            <span className="truncate type-caption text-text">{invite.email}</span>
            <span className="type-caption text-text-2"> as {invite.role}</span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="type-caption figures text-text-2">
              sent {ago(invite.created_at)}
            </span>
            <Button tone="danger" onClick={() => revoke.mutate(invite.id)}>
              Withdraw
            </Button>
          </span>
        </Row>
      ))}
    </Panel>
  );
}

function Projects({ org }: { org: string }) {
  const create = useCreateProject(org);
  const navigate = useNavigate();
  const { me } = useSession();
  const [name, setName] = useState("");
  const here = (me?.projects ?? []).filter((one) => one.org_id === org);

  return (
    <Panel title="Projects" note="One per deployment that sends runs.">
      {here.map((project) => (
        <Row key={project.id}>
          <span className="truncate type-caption text-text">{project.name}</span>
          <Button onClick={() => navigate(`/p/${project.id}/settings`)}>
            Settings
          </Button>
        </Row>
      ))}
      <form
        className="flex items-end gap-2 border-t border-hairline p-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          create.mutate(
            { name },
            {
              onSuccess: (made) => {
                setName("");
                navigate(`/p/${made.id}`);
              },
            }
          );
        }}
      >
        <div className="min-w-0 flex-1">
          <Field label="New project">
            {(id) => (
              <Input
                id={id}
                required
                placeholder="Staging"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Button type="submit" busy={create.isPending}>
          <Plus size={13} aria-hidden />
          Create
        </Button>
      </form>
      <Refused error={create.error} />
    </Panel>
  );
}

function Naming({ org, name }: { org: string; name: string }) {
  const rename = useRenameOrganization(org);
  const [value, setValue] = useState(name);
  return (
    <Panel title="Name">
      <form
        className="flex items-end gap-2 p-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          rename.mutate({ name: value });
        }}
      >
        <div className="min-w-0 flex-1">
          <Field label="What this organization is called">
            {(id) => (
              <Input
                id={id}
                value={value || name}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </Field>
        </div>
        <Button type="submit" busy={rename.isPending}>
          Rename
        </Button>
      </form>
      <Refused error={rename.error} />
    </Panel>
  );
}

function Removal({ org, name }: { org: string; name: string }) {
  const remove = useDeleteOrganization();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");

  return (
    <Panel
      title="Delete this organization"
      note="Every project in it, and everything recorded under those, goes with it."
    >
      <div className="grid gap-3 p-3">
        <Field label={`Type ${name} to confirm`}>
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
            disabled={typed !== name || name === ""}
            busy={remove.isPending}
            onClick={() =>
              remove.mutate(org, {
                onSuccess: () => navigate("/", { replace: true }),
              })
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


/**
 * A second organization.
 *
 * Anybody signed in may make one and owns what they made. Gating it on a
 * permission would need a role above owner, which is a role that exists only to
 * be the person who forgot to hand it over.
 *
 * A separate organization, rather than another project, is for work that
 * different people should see: membership is per organization, so this is the
 * only boundary that keeps one team's runs away from another's.
 */
export function NewOrganization() {
  const create = useCreateOrganization();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  return (
    <Frame>
      <div className="scroll-end min-h-0 overflow-y-auto bg-field">
        <div className="mx-auto grid max-w-xl gap-3 p-4">
          <header>
            <h1 className="type-title">New organization</h1>
            <p className="measure pt-1 type-small text-text-2">
              An organization owns projects and the people who may read them.
              Make one when a different set of people should see a different set
              of runs; if the same people should see it, make a project instead.
            </p>
          </header>
          <Panel title="What it is called">
            <form
              className="grid gap-3 p-3"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                create.mutate(
                  { name },
                  { onSuccess: (made) => navigate(`/orgs/${made.id}/settings`) }
                );
              }}
            >
              <Field
                label="Name"
                hint="Your company, or the team this belongs to. You will own it."
              >
                {(id) => (
                  <Input
                    id={id}
                    autoFocus
                    required
                    placeholder="Acme"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                )}
              </Field>
              <Refused error={create.error} />
              <div>
                <Button type="submit" tone="primary" busy={create.isPending}>
                  Create organization
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      </div>
    </Frame>
  );
}
