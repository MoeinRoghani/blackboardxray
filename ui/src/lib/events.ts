/**
 * The event vocabulary, mirroring `src/blackboardxray/events.py`.
 *
 * `blackboard.wire` exists so that one half of a protocol cannot spell a field
 * differently from the other. The two halves here get the same guarantee a
 * different way: this file states the same ten kinds and the same body shapes,
 * and `tests/test_wire_mirror.py` fails when they disagree. A kind added in
 * Python and forgotten here is a red build rather than a blank row in front of
 * an operator.
 */

export const EVENT_KINDS = [
  "run.opened",
  "agent.registered",
  "write.admitted",
  "write.refused",
  "write.conflicted",
  "premise.set",
  "notification.dispatched",
  "notification.acknowledged",
  "notification.failed",
  "run.closed",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export type Outcome = "settled" | "wall_clock_expired" | "aborted";

/** What is stored of a contribution. Size and shape always; content on opt in. */
export interface Carried {
  bytes: number;
  type: string;
  content?: unknown;
  preview?: string;
  truncated?: boolean;
  unreadable?: boolean;
}

export interface RegionDeclaration {
  name: string;
  kind: "level" | "premise";
  batch_window_seconds: number;
}

export interface AgentDeclaration {
  name: string;
  subscribes_to: string[] | null;
  writes_to: string[] | null;
}

/** One event, before its kind is known. */
interface EventBase {
  id: number;
  event_id: string;
  at: string;
  received_at: string;
  sequence: number | null;
  agent: string | null;
  region: string | null;
}

/**
 * The discriminated union. `kind` narrows `body`, so reading `cause` off a
 * refusal is checked and reading it off an acknowledgment does not compile.
 */
export type RunEvent =
  | (EventBase & {
      kind: "run.opened";
      body: {
        regions?: RegionDeclaration[];
        premises?: Record<string, Carried>;
        agents?: AgentDeclaration[];
        limits?: { wall_clock_seconds: number; idle_seconds: number };
        store?: string;
        has_admission_rule?: boolean;
        has_termination_predicate?: boolean;
      };
    })
  | (EventBase & {
      kind: "agent.registered";
      body: AgentDeclaration & { at_creation?: boolean };
    })
  | (EventBase & {
      kind: "write.admitted" | "premise.set";
      body: {
        version?: number | null;
        repeated?: boolean;
        content?: Carried;
        idempotency_key?: string | null;
      };
    })
  | (EventBase & {
      kind: "write.refused";
      body: {
        cause?: string;
        reason?: string;
        content?: Carried;
        premise?: boolean;
      };
    })
  | (EventBase & {
      kind: "write.conflicted";
      body: {
        expected_version?: number | null;
        current_version?: number;
        content?: Carried;
      };
    })
  | (EventBase & {
      kind: "notification.dispatched";
      body: {
        notification_id?: number;
        from_sequence?: number;
        to_sequence?: number;
        regions?: string[];
      };
    })
  | (EventBase & {
      kind: "notification.acknowledged";
      body: { notification_id?: number };
    })
  | (EventBase & {
      kind: "notification.failed";
      body: { notification_id?: number; error?: string; detail?: string };
    })
  | (EventBase & {
      kind: "run.closed";
      body: {
        outcome?: Outcome;
        reason?: string | null;
        unfinished?: string[];
      };
    });

/**
 * Whether this event changed the board.
 *
 * This is the distinction the whole product turns on, and it is what the spine
 * renders. A write took a sequence number and is part of the record. A
 * notification, an acknowledgment or a refusal is something the run did and
 * took no number, so it hangs off the spine rather than sitting on it.
 */
export function changedTheBoard(event: RunEvent): boolean {
  return event.sequence !== null && event.sequence > 0;
}

/** What each kind is called in the interface. The library's own words. */
export const KIND_LABEL: Record<EventKind, string> = {
  "run.opened": "Run opened",
  "agent.registered": "Agent registered",
  "write.admitted": "Write admitted",
  "write.refused": "Write refused",
  "write.conflicted": "Premise conflicted",
  "premise.set": "Premise set",
  "notification.dispatched": "Notification dispatched",
  "notification.acknowledged": "Acknowledged",
  "notification.failed": "Delivery failed",
  "run.closed": "Run closed",
};

/**
 * Which of the four reserved hues a kind reads in.
 *
 * Only the kinds that carry a problem get a hue. Everything ordinary is
 * neutral, so a coloured row on the screen always means something.
 */
export type Tone = "neutral" | "live" | "ok" | "warn" | "bad";

export const KIND_TONE: Record<EventKind, Tone> = {
  "run.opened": "neutral",
  "agent.registered": "neutral",
  "write.admitted": "neutral",
  "write.refused": "warn",
  "write.conflicted": "warn",
  "premise.set": "neutral",
  "notification.dispatched": "neutral",
  "notification.acknowledged": "neutral",
  // An agent that was never told is the one failure nothing else reports.
  "notification.failed": "bad",
  "run.closed": "neutral",
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  settled: "Settled",
  wall_clock_expired: "Wall clock expired",
  aborted: "Aborted",
};

/**
 * The same three outcomes, in a column.
 *
 * "Wall clock expired" is the library's own name for it and is what a run's
 * own header says. In a dense table it is three words in a column sized for
 * one, so it overran into the board beside it. A column states which of four
 * things happened; the full phrase is one line above it, in the panel.
 */
export const OUTCOME_SHORT: Record<Outcome, string> = {
  settled: "Settled",
  wall_clock_expired: "Expired",
  aborted: "Aborted",
};

export const OUTCOME_TONE: Record<Outcome, Tone> = {
  settled: "ok",
  wall_clock_expired: "warn",
  aborted: "bad",
};

/**
 * How a run reads right now.
 *
 * An open run is live; a closed one takes its outcome's tone. Three components
 * were each deciding this with their own nested conditional, which is three
 * places for the same rule to drift.
 */
export function runTone(outcome: Outcome | null): Tone {
  return outcome === null ? "live" : OUTCOME_TONE[outcome];
}
