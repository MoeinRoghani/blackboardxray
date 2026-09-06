/**
 * The controls the administrative screens are built from.
 *
 * The instrument itself has almost no forms: it reads. Everything that writes
 * is here, and it is deliberately plain, because a control that decorates
 * itself competes with the data it sits beside.
 *
 * There is one filled button and it means "this is the thing this screen is
 * for". Everything else is quiet. A screen with two filled buttons has not
 * decided what it is for.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useId } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  const described = `${id}-note`;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="type-caption font-medium text-text">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p id={described} className="type-caption text-bad" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={described} className="measure type-caption text-text-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      className={cn(
        "move-state h-8 w-full rounded-sm border bg-plane px-2 type-small text-text",
        "placeholder:text-text-2",
        invalid ? "border-bad-edge" : "border-edge",
        rest.className
      )}
    />
  );
}

export function Select({
  children,
  ...rest
}: InputHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      {...(rest as object)}
      className="move-state h-8 rounded-sm border border-edge bg-plane px-1.5 type-small text-text"
    >
      {children}
    </select>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "primary" | "quiet" | "danger";
  busy?: boolean;
}

export function Button({
  tone = "quiet",
  busy = false,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "move-state inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border px-3",
        "type-small disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" &&
          "border-live-edge bg-live-solid font-medium text-plane hover:opacity-90",
        tone === "quiet" && "border-edge bg-plane text-text hover:bg-hover",
        tone === "danger" && "border-bad-edge bg-plane text-bad hover:bg-bad-wash",
        rest.className
      )}
    >
      {busy ? <Loader2 size={13} aria-hidden className="spin" /> : null}
      {children}
    </button>
  );
}

/** A bordered region with a heading. The unit every settings screen is made of. */
export function Panel({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-rule bg-plane">
      <header className="flex items-center gap-3 border-b border-hairline bg-plane-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="type-caption font-medium text-text">{title}</h2>
          {note ? <p className="measure type-caption text-text-2">{note}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * What a screen says when the platform refused it.
 *
 * Always the sentence the server wrote. The platform knows why it refused and
 * an interface that replaces that with "Something went wrong" has thrown away
 * the only useful part of the answer.
 */
export function Refused({ error }: { error: { message: string } | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="measure rounded-sm bg-bad-wash px-2 py-1.5 type-caption text-bad">
      {error.message}
    </p>
  );
}

/** A row in a settings table. Same density as the instrument's own tables. */
export function Row({ children }: { children: ReactNode }) {
  return (
    <div className="row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 last:border-b-0">
      {children}
    </div>
  );
}

export function Nothing({ children }: { children: ReactNode }) {
  return <p className="measure px-3 py-3 type-caption text-text-2">{children}</p>;
}
