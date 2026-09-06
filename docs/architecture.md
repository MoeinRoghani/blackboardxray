# How it fits together

Two halves that are deployed separately and versioned separately, and one
database between them.

```
your application                        the platform
┌───────────────────────────┐          ┌──────────────────────────────────┐
│  blackboardx              │          │  FastAPI                         │
│    Control, AgentBoard    │          │    /api/v1/ingest    key         │
│         ▲                 │          │    /api/v1/auth/*    session     │
│         │ wraps           │  HTTPS   │    /api/v1/orgs/*    session     │
│  blackboardxray.Xray  ────┼─────────▶│    /api/v1/projects/{id}/*       │
│    bounded queue          │  batches │                                  │
│    worker thread          │          │  ┌────────────────────────────┐  │
└───────────────────────────┘          │  │ Postgres                   │  │
                                       │  │  events, runs, projects,   │  │
   a browser ────────────────────────▶ │  │  orgs, users, sessions,    │  │
     session cookie                    │  │  keys, invites, audit      │  │
                                       │  └────────────────────────────┘  │
                                       │  built interface served from /   │
                                       └──────────────────────────────────┘
```

## The client

`Xray.create_model` mirrors `blackboard.create_model` exactly and returns the
library's own model. What comes back is wrapped: the control component, each
agent board, and each agent's `notify` callback. Every write, refusal,
notification, acknowledgment and outcome therefore passes through something
that can record it, and the library itself is untouched.

**A record never blocks a writer.** The control component calls an agent on the
thread of whichever agent just wrote, so sending from there would make every
write pay a round trip. A record goes on a bounded queue and the caller
returns. A worker batches and sends.

**The queue is bounded and drops rather than blocks.** An unbounded queue turns
a platform that is down into an application that runs out of memory. Telemetry
that stalls a run has done more damage than the telemetry was worth. Drops are
counted, and the count is what an operator reads to learn it happened.

**Nothing raises into a caller.** A failed send is retried with jittered
backoff, then dropped and counted. A `Retry-After` from the platform is obeyed.

## The wire

Ten event kinds, one body shape. `Event` carries `board_id`, `kind`,
`event_id`, `at`, and optionally `sequence`, `agent`, `region` and a `body`
particular to the kind.

`event_id` is the idempotency key. The server writes an identifier once however
many times it arrives, so a batch resent after a timeout adds nothing. The
client generates it, because only the client knows that two attempts are the
same attempt.

`sequence` is the board's own number where the event has one, and the interface
is built on it rather than on `at`. `at` is the sending process's clock and is
used for latency alone, because agents run as separate services and their
clocks disagree.

Decoding is tolerant in both directions. An unrecognised field is ignored, an
absent field takes its default, and a name is never reused for a different
meaning. A kind added later reaches an older server as a row it stores and does
not interpret.

`src/blackboardxray/events.py` and `ui/src/lib/events.ts` state the same
vocabulary twice, and `tests/test_wire_mirror.py` fails when they disagree.

## The server

**Two doors, and they are not the same.** An application sends with a key
belonging to one project; it is a machine holding a bearer token and may only
write. A person reads with a session cookie, through a membership and a role.

**Counters are denormalised and written in the same transaction as the events
that move them**, so the runs list is one read and never disagrees with the
events behind it.

**The schema is applied on start.** Migrations are numbered files applied once
and recorded with their checksum. Replicas take an advisory lock first, so
starting four containers at once applies each migration once.

## The interface

Vite, React, TypeScript strict, Tailwind reading a three-tier token pipeline. A
screen may not set a value; see `design-system.md`.

It is built into the Python package, so `pip install blackboardxray[server]`
gives an operator the whole platform and the container carries no Node.

## Authorization

An organization owns projects. A person is a member of an organization with a
role, and a role on one project replaces the organization's in either
direction.

The check is one function. A project is resolved from its public identifier,
the membership and any project role are read together, the effective role is
computed, and the permission is looked up in a table. A project the caller
cannot read answers 404 rather than 403, so belonging cannot be probed.

## What runs in the background

One loop, in-process, holding an advisory lock so only one replica does it. It
removes runs past a project's retention window, in chunks so no lock is held
long, and removes expired sessions. It is stopped and waited for on shutdown.
