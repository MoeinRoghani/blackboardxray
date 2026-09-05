/**
 * Loading is the final layout with its text replaced by a shimmer of the same
 * shape, so nothing moves when the data lands.
 */
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("shimmer rounded-sm bg-surface-sunken", className)}
      aria-hidden
    />
  );
}

/** A run row's shape, for the runs list while it loads. */
export function RowSkeleton({ columns }: { columns: number }) {
  return (
    <div className="flex items-center gap-4 border-b border-border-subtle px-4 py-3">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-1 items-center justify-end gap-6">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-4 w-10" />
        ))}
      </div>
    </div>
  );
}
