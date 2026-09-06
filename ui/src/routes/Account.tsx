/**
 * Your own account: your password, and everywhere you are signed in.
 *
 * The session list is the useful half. A platform that holds a record of what
 * a company's systems did should be able to answer "where am I signed in", and
 * ending the others is the one thing somebody wants at the moment they suspect
 * an answer they do not like.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { Frame } from "@/components/Frame";
import { Button, Field, Input, Nothing, Panel, Refused, Row } from "@/components/Form";
import { ago, instant } from "@/lib/format";
import { useChangePassword, useEndOtherSessions, useSessions } from "@/lib/admin";
import { useSession } from "@/lib/session";

export function Account() {
  const { me } = useSession();

  return (
    <Frame>
      <div className="scroll-end min-h-0 overflow-y-auto bg-field">
        <div className="mx-auto grid max-w-3xl gap-3 p-4">
          <header>
            <h1 className="type-title">{me?.user.name || me?.user.email || "Account"}</h1>
            <p className="measure pt-1 type-small text-text-2">{me?.user.email}</p>
          </header>
          <Password />
          <Sessions />
        </div>
      </div>
    </Frame>
  );
}

function Password() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [replacement, setReplacement] = useState("");

  return (
    <Panel
      title="Password"
      note="Changing it ends every other session, because the reason to change one is usually that somebody else has it."
    >
      <form
        className="grid gap-3 p-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          change.mutate(
            { current, replacement },
            {
              onSuccess: () => {
                setCurrent("");
                setReplacement("");
              },
            }
          );
        }}
      >
        <Field
          label="Current password"
          hint="Asked for even though you are signed in, because a session is what somebody borrowing an unlocked laptop has."
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              className="max-w-sm"
            />
          )}
        </Field>
        <Field label="New password" hint="At least ten characters.">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              className="max-w-sm"
            />
          )}
        </Field>
        <Refused error={change.error} />
        <div className="flex items-center gap-3">
          <Button type="submit" tone="primary" busy={change.isPending}>
            Change password
          </Button>
          {change.isSuccess ? (
            <span className="type-caption text-ok" role="status">
              Changed. Every other session has ended.
            </span>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

function Sessions() {
  const sessions = useSessions();
  const endOthers = useEndOtherSessions();
  const rows = sessions.data?.sessions ?? [];
  const others = rows.filter((one) => !one.is_current).length;

  return (
    <Panel
      title="Where you are signed in"
      note="Each is one browser. Ending one signs it out immediately."
      action={
        others > 0 ? (
          <Button
            tone="danger"
            onClick={() => endOthers.mutate()}
            busy={endOthers.isPending}
          >
            End the other {others === 1 ? "session" : `${others} sessions`}
          </Button>
        ) : null
      }
    >
      {sessions.isLoading ? <Nothing>Loading.</Nothing> : null}
      {rows.map((one) => (
        <Row key={one.id}>
          <span className="min-w-0">
            <span className="truncate type-caption text-text">
              {browser(one.user_agent)}
              {one.is_current ? (
                <span className="text-live"> · this browser</span>
              ) : null}
            </span>
            <span
              className="block truncate type-caption figures text-text-2"
              title={instant(one.created_at)}
            >
              {one.address || "address not recorded"} · active {ago(one.last_seen_at)}
            </span>
          </span>
        </Row>
      ))}
      <Refused error={endOthers.error} />
    </Panel>
  );
}

/**
 * A user agent string, reduced to the part a person recognises.
 *
 * Not a parser. It picks the browser and the platform out of a string that was
 * designed to lie about both, and says so plainly where it cannot.
 */
function browser(agent: string): string {
  if (!agent) return "Unknown browser";
  const engine =
    /Firefox\/\d/.test(agent)
      ? "Firefox"
      : /Edg\/\d/.test(agent)
        ? "Edge"
        : /Chrome\/\d/.test(agent)
          ? "Chrome"
          : /Safari\/\d/.test(agent)
            ? "Safari"
            : "Unknown browser";
  const platform = /Mac OS X/.test(agent)
    ? "macOS"
    : /Windows/.test(agent)
      ? "Windows"
      : /Android/.test(agent)
        ? "Android"
        : /iPhone|iPad/.test(agent)
          ? "iOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return platform ? `${engine} on ${platform}` : engine;
}
