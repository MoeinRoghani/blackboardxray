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

## A contribution's content is not stored by default

A write records the size and the shape of its content and none of the content.
A deployment whose contributions are not sensitive passes `content_limit` and
gets the content up to that many bytes, truncated past it.

The default is the safe one because a contribution is the application's own
data and this platform should not be the reason it leaves the process.

## The platform never reads your board

Everything here arrived because an application sent it. There is no connection
to your store, so a gap left by dropped events cannot be filled in later by
reading the record. The board remains the source of truth about what was
written; this is the record of what the run did about it.

## Events can be dropped, and the count is the only evidence

The sender holds a bounded queue. A platform that is down, or an application
producing faster than the queue drains, means events are dropped rather than a
run being stalled, because telemetry that stalls a run has done more damage than
the telemetry was worth.

`Xray.dropped` counts them and `on_drop` is called with each batch and its
reason. A dropped event leaves a hole that nothing repairs.

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
