/**
 * Empty and error, as designed layouts rather than a message centred in a void.
 *
 * Empty says what would put something here and gives the command that does it.
 * Error names what failed and what to check, and never says something went
 * wrong.
 */
import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon: Icon,
  title,
  children,
  command,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  command?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 border border-border-subtle",
        "rounded-md bg-surface-raised p-8",
        className
      )}
    >
      <Icon aria-hidden className="size-5 text-text-secondary" />
      <h2 className="type-heading text-text-primary">{title}</h2>
      <div className="type-small max-w-prose text-text-secondary">{children}</div>
      {command ? (
        <pre className="numeric mt-1 w-full overflow-x-auto rounded-sm border border-border-subtle bg-surface-sunken p-3 type-caption text-text-primary">
          <code>{command}</code>
        </pre>
      ) : null}
    </div>
  );
}

export function ErrorState({
  error,
  className,
}: {
  error: ApiError | Error | null;
  className?: string;
}) {
  const isApi = error instanceof ApiError;
  const code = isApi ? error.code : "unexpected";
  const detail = error?.message ?? "The platform did not say what failed.";
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-md border",
        "border-aborted-border bg-aborted-bg p-6",
        className
      )}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle aria-hidden className="size-4 text-aborted-text" />
        <h2 className="type-heading text-aborted-text">{TITLE[code] ?? "This did not load"}</h2>
      </div>
      <p className="type-small max-w-prose text-aborted-text">{detail}</p>
      <p className="type-caption text-aborted-text opacity-80">
        {CHECK[code] ?? "Check the server log for the request that failed."}
      </p>
    </div>
  );
}

/** What to call each failure, and what to check about it. */
const TITLE: Record<string, string> = {
  unreachable: "The platform is not answering",
  no_project: "No project exists yet",
  unknown_project: "No project by that name",
  unknown_run: "No run on that board",
  unknown_agent: "No agent by that name",
};

const CHECK: Record<string, string> = {
  unreachable:
    "Check that `blackboardxray serve` is running and that it is on the port this page expects.",
  no_project:
    "Create one with `blackboardxray project <slug>`, then issue a key with `blackboardxray key <slug>`.",
  unknown_project: "Check the project parameter against the ones in Settings.",
  unknown_run:
    "The board identifier is opaque to the platform, so a run appears only once something has been sent for it.",
  unknown_agent: "An agent appears once it has written or been notified in some run.",
};
