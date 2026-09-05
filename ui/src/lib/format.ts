/**
 * How a number or an instant is written.
 *
 * One place, because the same duration formatted two ways on two screens reads
 * as two different measurements.
 */

/** A count, grouped, for reading rather than for arithmetic. */
export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "0";
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * A duration in seconds, at the precision the magnitude deserves.
 *
 * Sub-second work is reported in milliseconds because agent response times
 * live there, and anything past a minute is reported coarsely because nobody
 * reads the seconds on a nine minute run.
 */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return "not measured";
  }
  if (seconds < 0) return "not measured";
  // An agent answering in process is faster than a millisecond, and rounding
  // that to "0ms" reads as a broken measurement rather than a fast one.
  if (seconds < 0.001) return "<1ms";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** The gap between two instants, as a duration. */
export function between(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 1000;
}

/** An absolute instant, to the second, in the reader's own zone. */
export function instant(value: string | null | undefined): string {
  if (!value) return "not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "not recorded";
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** The clock alone, to the millisecond, for reading a timeline. */
export function clock(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const time = parsed.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${time}.${String(parsed.getMilliseconds()).padStart(3, "0")}`;
}

/** How long ago, for a list where the exact instant is a hover away. */
export function ago(value: string | null | undefined): string {
  if (!value) return "never";
  const seconds = (Date.now() - Date.parse(value)) / 1000;
  if (Number.isNaN(seconds)) return "never";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** A size in bytes, at the precision the magnitude deserves. */
export function bytes(value: number | null | undefined): string {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
