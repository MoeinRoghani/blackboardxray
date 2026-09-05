# PRODUCT.md

Durable product context. Written from the maintainer's brief without an
interview, because the build was authorised to run without stopping. Every
assumption is labelled `ASSUMED` and is cheap to correct.

## What it is

`blackboardxray` is a self-hosted observability platform for blackboard runs. It
is one server, one database and one web interface. An application that runs
`blackboardx` reaches it by naming an endpoint and a token, and thereafter every
run that application opens is visible here.

## Who it is for

Engineers operating a blackboard deployment, in two moments.

**During a run.** A run is open, something looks wrong, and the operator needs to
see which agents were woken, which answered, and what the board holds now.

**After a run.** A run closed as `settled` with two agents named unfinished, and
the operator needs to know what those agents were asked to do and where they
stopped.

`ASSUMED`: the operator is the same person who deploys the blackboard service,
not a separate on-call rotation, so the interface may use the library's own
vocabulary without translating it.

## The job it is hired for

*Tell me what the run did, in the order it did it, and show me where it stopped
being healthy.*

Everything else is secondary to that sentence.

## The one opinionated bet

**The sequence is the spine.** Every other observability tool reconstructs an
ordering from timestamps that came off machines whose clocks disagree.
`blackboardx` hands us a gapless total order, assigned by the store, where every
write's number is also its address. The interface is built on that number rather
than on wall-clock time, and that is what makes it legible where a trace viewer
is a pile of overlapping bars.

Wall-clock time is still shown, because latency is a real question. It is never
the primary axis.

## Platform

Web, desktop first. Operators read this on a laptop beside a terminal.
`ASSUMED`: no mobile requirement beyond not breaking. Responsive down to 768px,
not designed for a phone.

## Constraints that outrank taste

- **Server side only.** There is no browser to instrument and no client SDK.
- **The library is not modified.** Everything is observed from the application's
  boundary, by wrapping.
- **Dropping telemetry never breaks a run.** The client is bounded, it retries,
  and when it cannot deliver it drops and counts. It never raises into a writer.
- **Content may be sensitive.** A contribution's body is truncated by default and
  the operator opts in to storing it.

## Surfaces

| Surface | Mode | Job |
| --- | --- | --- |
| Overview | Operate | Is anything wrong right now |
| Runs | Operate | Find the run I mean |
| Run detail | Operate | What happened, in order, and where it stopped |
| Agents | Operate | Which agent is misbehaving, across runs |

There is no marketing surface. This is an internal tool and its front door is the
runs list.

## Voice

Flat, precise, and in the library's own vocabulary. A run is settled, not
"completed successfully". An agent is unfinished, not "failed". A write is
refused with a reason the admission rule wrote, and that reason is shown verbatim
rather than summarised.

Tone shifts in one place. Where a run ended badly the interface states the fact
and what is known, and does not soften it.

## What it is not

Not a metrics system, so no Prometheus replacement. Not an alerting system, so no
paging. Not a debugger, so it does not let you write to a board. It reads.
