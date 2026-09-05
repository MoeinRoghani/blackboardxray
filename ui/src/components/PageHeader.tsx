import type { ReactNode } from "react";

/**
 * A page's title, and the controls that act on what is below it.
 *
 * There is no eyebrow above the title. The rail already says which section
 * this is, so a label repeating it would be the second time the reader is told
 * where they are.
 */
export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="type-title text-text-primary">{title}</h1>
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-small text-text-secondary">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
