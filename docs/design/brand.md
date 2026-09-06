# Brand

Stage 1 of the Product Design Procedure. Written before any screen, because the
stance fixes hundreds of decisions downstream.

## The stance

An **instrument**, not a dashboard.

A dashboard summarises. It answers "how is it going" with a number that has
already thrown away what produced it. An instrument records, at full fidelity,
in one continuous ordered trace, and lets a trained reader find the moment
something changed. A seismograph, a logic analyzer, a printed ledger.

The product is for an engineer who already knows what a blackboard run is. It
does not explain the domain, it does not congratulate, and it does not round
numbers off to make them look tidy. It shows the trace.

## The one opinionated bet

**The sequence number is the spine.**

Every other observability tool reconstructs an order out of timestamps taken
from machines whose clocks disagree, and the result is a pile of overlapping
bars that the reader has to mentally re-sort. `blackboardx` assigns a gapless
total order in the store, and every write's number is also its address. So the
interface is a single numbered column read top to bottom, and everything else
hangs off it.

What this fixes downstream:

- Layout is a vertical ledger, not a horizontal Gantt.
- Numbers are monospaced without exception, because a sequence number is read
  digit by digit and compared against another one.
- Wall-clock time is present and never primary. It answers "how long", not
  "what order".
- There are no summary cards floating above the data. The counts sit in the
  same rail as the thing they count.

## Voice

The library's own vocabulary, used exactly. A run is **settled**, not
"completed successfully". An agent is **unfinished**, not "failed". A write is
**refused**, and the reason shown is the string the application's admission rule
wrote, verbatim and untruncated.

Flat, declarative, no adverbs. The interface never says "successfully" and never
says "oops".

### Tone by state

| State | Override |
| --- | --- |
| Settled | Nothing. State the outcome and stop. |
| Unfinished agents present | Name them. Do not soften and do not explain them away. |
| Aborted | Show the reason string the caller gave, in full, before anything else. |
| Wall clock expired | State that the limit passed, and what the limit was. |
| Refused | The rule's own reason, verbatim. Never paraphrased. |
| Delivery failed | Say the agent never received it, because that is the fact an operator needs and it is not obvious. |
| Empty | Say what would put something here, in one sentence, with the command to run. |
| Error | Name what failed and what to check. Never "something went wrong". |

## Terms

One word per concept, used system-wide. Taken from the blackboard literature and
from `blackboardx` itself, never invented here.

| Term | Means |
| --- | --- |
| run | One board's life, from created to closed |
| board | The shared structure the run writes to |
| region | A named part of a board |
| level | A region that accumulates in arrival order |
| premise | A region holding one current value under a version |
| contribution | One unit written to a level |
| sequence | A write's position in the total order, and its address |
| agent | A named participant that reads and writes |
| notification | Being told the board changed. Carries no values |
| acknowledgment | An agent reporting it has stopped working on a notification |
| admission | The decision to let a proposed write reach the board |
| refusal | Admission saying no, with a reason |
| conflict | A premise write naming a version that is no longer current |
| outcome | One of settled, wall clock expired, aborted |
| unfinished | An agent still holding an unacknowledged notification at close |

Words that do not appear anywhere in this product: trace, span, observation,
session, user, score, telemetry, metric, insight, journey.
