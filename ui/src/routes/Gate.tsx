/**
 * The three screens somebody sees before they are inside.
 *
 * They share a shape and it is not the instrument's. The application proper is
 * welded to the viewport edges because it is a window onto a running system;
 * these are a single decision on an empty ground, so they are centred and
 * small. Using the frame here would promise a system that is not there yet.
 *
 * First run is the one that matters. An install with nobody in it ends this
 * screen with an owner, an organization, a project and a key that already
 * works, because the alternative is a person who signed up and now has an
 * empty page and no idea what to do with it.
 */
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { Button, Field, Input, Refused } from "@/components/Form";
import { cn } from "@/lib/cn";
import {
  useInvitation,
  useJoin,
  useSession,
  useSetup,
  useSignIn,
} from "@/lib/session";

function Ground({
  title,
  note,
  children,
  wide,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-void p-4">
      <div className={cn("w-full min-w-0", wide ? "max-w-xl" : "max-w-sm")}>
        <div className="flex items-center gap-2 pb-4">
          <Mark />
          <span className="type-small font-medium tracking-tight text-text">
            blackboard<span className="text-text-2">xray</span>
          </span>
        </div>
        <div className="min-w-0 rounded-md border border-rule bg-plane p-4">
          <h1 className="type-heading text-text">{title}</h1>
          {note ? <p className="measure pt-1 type-caption text-text-2">{note}</p> : null}
          <div className="min-w-0 pt-4">{children}</div>
        </div>
      </div>
    </main>
  );
}

function Mark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="text-live-solid">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <path d="M1.5 9.5h4l2-4 2.5 6 2-2h2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function SignIn() {
  const { state } = useSession();
  const signIn = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (state?.needs_setup) return <Navigate to="/setup" replace />;
  if (state?.user) return <Navigate to="/" replace />;

  return (
    <Ground title="Sign in" note="This platform is reachable to whoever your network lets reach it. Your account is what decides which runs you can read.">
      <form
        className="grid gap-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          signIn.mutate({ email, password });
        }}
      >
        <Field label="Email">
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Refused error={signIn.error} />
        <Button type="submit" tone="primary" busy={signIn.isPending}>
          Sign in
        </Button>
      </form>
    </Ground>
  );
}

export function FirstRun() {
  const { state } = useSession();
  const setup = useSetup();
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    organization: "",
    project: "Production",
  });
  const at = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((was) => ({ ...was, [key]: event.target.value }));

  if (state && !state.needs_setup && !setup.isSuccess) {
    return <Navigate to="/signin" replace />;
  }
  if (setup.isSuccess) return <FirstKey result={setup.data} />;

  return (
    <Ground
      title="Set this platform up"
      note="Nobody has an account here yet. This makes yours, an organization to own the work, a first project, and a key an application can send with."
      wide
    >
      <form
        className="grid gap-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setup.mutate(form);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your name">
            {(id) => <Input id={id} autoFocus value={form.name} onChange={at("name")} />}
          </Field>
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="username"
                required
                value={form.email}
                onChange={at("email")}
              />
            )}
          </Field>
        </div>
        <Field
          label="Password"
          hint="At least ten characters. A phrase you can remember beats a short word you cannot."
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={form.password}
              onChange={at("password")}
            />
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Organization" hint="Your company or team.">
            {(id) => (
              <Input
                id={id}
                placeholder="Default"
                value={form.organization}
                onChange={at("organization")}
              />
            )}
          </Field>
          <Field label="First project" hint="One deployment sending runs.">
            {(id) => <Input id={id} value={form.project} onChange={at("project")} />}
          </Field>
        </div>
        <Refused error={setup.error} />
        <Button type="submit" tone="primary" busy={setup.isPending}>
          Create the first account
        </Button>
      </form>
    </Ground>
  );
}

/**
 * The one moment the key exists outside the sender's memory.
 *
 * A screen of its own rather than a line on the last one, because it is the
 * only thing on it and because leaving it costs the reader the key. The
 * database holds a digest and cannot show it again, so the way out says so.
 */
function FirstKey({
  result,
}: {
  result: { api_key: string; project: { id: string; name: string } };
}) {
  const navigate = useNavigate();
  return (
    <Ground
      title="Your first key"
      note="Give this to the application you want to watch. It is shown once: the platform keeps only a digest of it and cannot show it again."
      wide
    >
      <div className="grid min-w-0 gap-3">
        <Secret value={result.api_key} />
        <div className="min-w-0">
          <p className="type-caption text-text-2">Then wrap the model where it is created.</p>
          <pre className="code mt-1 overflow-x-auto rounded-sm border border-hairline bg-well p-2 text-text-2">
            <code>{`from blackboardxray import Xray

with Xray(endpoint="${window.location.origin}", token="${result.api_key}") as xray:
    model = xray.create_model(regions=..., agents=...)`}</code>
          </pre>
        </div>
        <Button
          tone="primary"
          onClick={() => navigate(`/p/${result.project.id}`, { replace: true })}
        >
          I have copied it. Open {result.project.name}
        </Button>
      </div>
    </Ground>
  );
}

/** A value to copy, and a control that says whether it was copied. */
export function Secret({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="flex items-stretch gap-1.5">
      <code className="code min-w-0 flex-1 truncate rounded-sm border border-hairline bg-well px-2 py-2 text-text">
        {value}
      </code>
      <Button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            // A browser that refuses the clipboard leaves the value on screen
            // to select by hand, which is why it is shown and not hidden.
          }
        }}
        className="h-auto shrink-0"
      >
        {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function Join() {
  const { token = "" } = useParams();
  const invitation = useInvitation(token);
  const join = useJoin();
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  if (join.isSuccess) return <Navigate to="/" replace />;

  if (invitation.isError) {
    return (
      <Ground title="This invitation cannot be used">
        <p className="measure type-small text-text-2">{invitation.error.message}</p>
        <div className="pt-3">
          <Link to="/signin" className="type-small text-live hover:underline">
            Go to sign in
          </Link>
        </div>
      </Ground>
    );
  }

  const offered = invitation.data;
  const known = offered?.has_account ?? false;

  return (
    <Ground
      title={offered ? `Join ${offered.organization}` : "Join"}
      note={
        offered
          ? known
            ? `${offered.email} already has an account here. Enter its password to accept as ${offered.role}.`
            : `You have been invited as ${offered.role}. Choose a password and the account is made.`
          : undefined
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          join.mutate({ token, password, name });
        }}
      >
        {offered ? (
          <Field label="Email">
            {(id) => <Input id={id} value={offered.email} readOnly disabled />}
          </Field>
        ) : null}
        {!known && offered ? (
          <Field label="Your name">
            {(id) => (
              <Input
                id={id}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field
          label="Password"
          hint={known ? undefined : "At least ten characters."}
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete={known ? "current-password" : "new-password"}
              required
              minLength={known ? undefined : 10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Refused error={join.error} />
        <Button
          type="submit"
          tone="primary"
          busy={join.isPending}
          disabled={!offered}
        >
          {known ? "Accept the invitation" : "Create my account"}
        </Button>
      </form>
    </Ground>
  );
}
