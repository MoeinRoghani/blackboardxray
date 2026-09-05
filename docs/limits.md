# What this version does not do

Every limit here is a limit of the platform as it stands, checked against the
code rather than remembered.

## Reading is not authenticated

Ingestion needs a key, because a key is how the platform knows which deployment
is sending and because a write matters. **Every read is open to whoever can
reach the server.**

That is deliberate and it is the same posture `blackboardx` takes with
`BoardService`: each operation has its own path and method so a gateway in front
can carry the policy. Put this behind whatever already fronts your internal
tools. Do not put it on a public address.

## A contribution's content is truncated past 4kB

Content is recorded. `content_limit` bounds one contribution and defaults to
4096 bytes, and anything past it is truncated with the record saying so, so a
contribution larger than that is present but not whole.

`content_limit=0` records the size and the shape and none of the content. That
is the setting for a deployment whose contributions carry something that may not
leave the process.

## Events can be dropped, and the count is the only evidence

The sender holds a bounded queue. A platform that is down, or an application
producing faster than the queue drains, means events are dropped rather than a
run being stalled, because telemetry that stalls a run has done more damage than
the telemetry was worth.

`Xray.dropped` counts them and `on_drop` is called with each batch and its
reason.

A dropped event leaves a hole that nothing repairs. The platform holds no
connection to your store and does not read the board, so it cannot backfill
from a record that is still sitting there. That is worth knowing because the
opposite is a reasonable assumption: the board is durable, and filling a gap
from it would be possible for a platform built to do it. This one is not.

## A run's timeline is in arrival order, not sequence order

The rows are ordered as the platform received them and the gutter shows the
board's own order. Those two orders can differ, and where they do it is
informative rather than wrong.

The clearest case: a premise write that wakes agents which write inline is
recorded after its own consequences, because the wrapper learns the outcome of a
call only when that call returns. Its sequence number is lower than the rows
above it, and that is visible in the gutter.

## Only the write path is observed

The wrappers see what passes through `Control`, through an `AgentBoard`, and
through each agent's `notify`. A read does not pass through any of them, by
design: reads bypass the control component in `blackboardx` and adding a wrapper
to them would make every read pay for a record of itself.

So the platform cannot tell you which agent read what, or that an agent was
notified and read nothing.

## An application that calls the library directly is invisible

The seam is the wrapper. Code holding the underlying `Control` rather than the
one `Xray.create_model` returned writes to the board without being recorded.
That is the cost of not modifying the library, and it is the right cost: the
library stays a library.

## There is no alerting, and no retention policy

Nothing here pages anyone, and nothing deletes anything. A row stays until you
delete it. `DELETE FROM xray_events WHERE received_at < now() - interval '90
days'` is the whole retention story, and when you run it is yours.

## One server, one database, no horizontal story

The platform is a single FastAPI process against one Postgres. It has been run
against real data and not against load. How many events a second it will take,
and at what point the runs list stops being one fast read, are unmeasured.

The counters on `xray_runs` are denormalised and moved in the same transaction
as the events that move them, so the list is one read at any size. The events
table is not partitioned.

## The schema is stamped forwards only

A database written for a schema this version cannot read is refused when the
server opens, rather than at whichever query first touches the change. The
platform never rewrites a record backwards, because an older version would then
read fields a newer one wrote and take them at face value.
