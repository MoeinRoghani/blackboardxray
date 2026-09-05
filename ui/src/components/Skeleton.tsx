/**
 * Loading is the final layout with its text replaced by a shape of the same
 * size, so nothing moves when the data lands.
 */
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("shimmer rounded-sm bg-surface-2", className)} aria-hidden />
  );
}

/** A run row's shape, for the list while it loads. */
export function RowSkeleton() {
  return (
    <div className="flex flex-col gap-2 border-b border-hairline px-4 py-3" aria-hidden>
      <Skeleton className="h-3.5 w-32" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}
