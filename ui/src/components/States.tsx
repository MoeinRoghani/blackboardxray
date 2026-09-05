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
        "flex flex-col items-start gap-2.5 rounded-lg border border-hairline",
        "bg-surface px-5 py-6",
        className
      )}
    >
      <Icon aria-hidden className="size-4 text-text-2" />
      <h2 className="type-heading">{title}</h2>
      <div className="max-w-prose type-small text-text-2">{children}</div>
      {command ? (
        <pre className="code mt-1 w-full overflow-x-auto rounded-md border border-hairline bg-canvas p-3 text-text-2">
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
  const code = error instanceof ApiError ? error.code : "unexpected";
  const detail = error?.message ?? "The platform did not say what failed.";
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-lg border border-bad-edge",
        "bg-bad-wash px-4 py-3",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle aria-hidden className="size-3.5 text-bad" />
        <h2 className="type-small font-medium text-bad">
          {TITLE[code] ?? "This did not load"}
        </h2>
      </div>
      <p className="max-w-prose type-caption text-bad">{detail}</p>
      <p className="max-w-prose type-caption text-text-2">
        {CHECK[code] ?? "Check the server log for the request that failed."}
      </p>
    </div>
  );
}

const TITLE: Record<string, string> = {
  unreachable: "The platform is not answering",
  no_project: "No project exists yet",
  unknown_project: "No project by that name",
  unknown_run: "No run on that board",
  unknown_agent: "No agent by that name",
};

const CHECK: Record<string, string> = {
  unreachable:
    "Check that `blackboardxray serve` is running and on the port this page expects.",
  no_project:
    "Create one with `blackboardxray project <slug>`, then issue a key with `blackboardxray key <slug>`.",
  unknown_project: "Check the project against the ones in Settings.",
  unknown_run:
    "The board identifier is opaque to the platform, so a run appears only once something has been sent for it.",
  unknown_agent: "An agent appears once it has written or been notified in some run.",
};
