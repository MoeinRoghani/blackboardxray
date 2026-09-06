/**
 * The strip that narrows the table, and doubles as the overview.
 *
 * There is no separate overview screen. The counts an operator would go to one
 * for are the same counts that narrow the list, so they are the same control:
 * reading "aborted 106" and clicking it to see which 106 is one motion rather
 * than two screens. A number here is always the number of runs the table would
 * hold if this were pressed, taken with every other filter applied.
 *
 * Each facet carries its word, its count and its swatch together, which is what
 * lets the chart above use hue at all.
 */
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { count } from "@/lib/format";
import type { Facets as Data } from "@/lib/api";
import type { OutcomeFilter } from "@/lib/query";

const OUTCOMES: { key: OutcomeFilter; label: string; from: keyof Data; dot: string }[] = [
  { key: "open", label: "Open", from: "open", dot: "bg-live-solid" },
  { key: "settled", label: "Settled", from: "settled", dot: "bg-ok-solid" },
  { key: "aborted", label: "Aborted", from: "aborted", dot: "bg-bad-solid" },
  { key: "wall_clock_expired", label: "Expired", from: "expired", dot: "bg-warn-solid" },
];

export function Facets({
  data,
  outcome,
  unfinished,
  agent,
  narrowed,
  ranged,
  onOutcome,
  onUnfinished,
  onAgent,
  onClearRange,
  onClear,
}: {
  data: Data | undefined;
  outcome: OutcomeFilter | null;
  unfinished: boolean;
  agent: string | null;
  narrowed: boolean;
  ranged: string | null;
  onOutcome: (outcome: OutcomeFilter) => void;
  onUnfinished: () => void;
  onAgent: (agent: string | null) => void;
  onClearRange: () => void;
  onClear: () => void;
}) {
  return (
    <div className="band band-under flex h-facet items-center gap-1 overflow-x-auto px-2">
      <span className="type-label shrink-0 pr-1">Outcome</span>
      {OUTCOMES.map((facet) => (
        <Facet
          key={facet.key}
          label={facet.label}
          value={data ? (data[facet.from] as number) : null}
          dot={facet.dot}
          on={outcome === facet.key}
          onClick={() => onOutcome(facet.key)}
        />
      ))}

      <Rule />

      <Facet
        label="Unfinished agents"
        value={data?.unfinished ?? null}
        icon={<AlertTriangle size={11} aria-hidden />}
        on={unfinished}
        onClick={onUnfinished}
      />

      {data?.agents.length ? (
        <>
          <Rule />
          <label className="type-label shrink-0 pr-1" htmlFor="facet-agent">
            Agent
          </label>
          <select
            id="facet-agent"
            value={agent ?? ""}
            onChange={(event) => onAgent(event.target.value || null)}
            className={cn(
              "move-state h-6 shrink-0 rounded-sm border border-edge bg-plane px-1.5 type-caption text-text",
              agent && "border-live-edge bg-live-wash"
            )}
          >
            <option value="">any</option>
            {data.agents.map((one) => (
              <option key={one.name} value={one.name}>
                {one.name} ({one.runs})
              </option>
            ))}
          </select>
        </>
      ) : null}

      <span className="flex-1" />

      {ranged ? (
        <button
          type="button"
          onClick={onClearRange}
          className="move-state flex shrink-0 items-center gap-1 rounded-sm border border-live-edge bg-live-wash px-1.5 type-caption text-live"
        >
          <span className="figures">{ranged}</span>
          <X size={11} aria-hidden />
          <span className="sr-only">Clear the selected interval</span>
        </button>
      ) : null}

      {narrowed ? (
        <button
          type="button"
          onClick={onClear}
          className="move-state shrink-0 rounded-sm px-1.5 type-caption text-text-2 hover:bg-hover hover:text-text"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function Rule() {
  return <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-hairline" />;
}

function Facet({
  label,
  value,
  dot,
  icon,
  on,
  onClick,
}: {
  label: string;
  value: number | null;
  dot?: string;
  icon?: React.ReactNode;
  on: boolean;
  onClick: () => void;
}) {
  const none = value === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      disabled={none && !on}
      className={cn(
        "move-state flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-1.5 type-caption",
        on
          ? "border-live-edge bg-live-wash text-text"
          : "border-transparent text-text-2 hover:bg-hover hover:text-text",
        none && !on && "opacity-45"
      )}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", dot)} /> : null}
      {icon}
      <span>{label}</span>
      <span className="figures font-medium text-text">{value === null ? "" : count(value)}</span>
    </button>
  );
}
