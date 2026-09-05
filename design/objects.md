# Object model and navigation

Stage 2 of the Product Design Procedure. The object graph is settled before any
screen, so one object renders one way everywhere.

## The objects

Ordered by how often an operator acts on them.

### Run

One board's run. The spine of everything.

| Attribute | From | Notes |
| --- | --- | --- |
| `board_id` | the application | Opaque. Usually a UUID or an incident number |
| `project` | the API key | Which deployment sent this |
| `opened_at` | `run.opened` | |
| `closed_at` | `run.closed` | Null while open |
| `outcome` | `run.closed` | `settled`, `wall_clock_expired`, `aborted`, or open |
| `reason` | `run.closed` | Present only on `aborted` |
| `unfinished` | `run.closed` | Agent names still holding a notification |
| `limits` | `run.opened` | The wall clock and idle durations |
| `regions` | `run.opened` | Name and kind, in declaration order |
| `last_sequence` | derived | The highest sequence seen |
| `counts` | derived | Writes, refusals, conflicts, notifications, acks |

Actions: open, filter, compare against another run.

Relationships: has many Events, has many Agents, has many Regions.

### Event

One thing that happened in a run. This is the unit the timeline is built from.

| Attribute | Notes |
| --- | --- |
| `event_id` | The client's idempotency key for this event |
| `run` | Which run |
| `kind` | One of the ten kinds below |
| `sequence` | The board's sequence number, where the event has one |
| `at` | The client's clock, for latency only |
| `received_at` | The server's clock, which is authoritative for ordering ties |
| `agent` | The writer, the notified agent, or the acknowledger |
| `region` | Where it landed, where it has one |
| `body` | Kind-specific, stored as JSON |

The ten kinds, and nothing else is invented:

`run.opened`, `agent.registered`, `write.admitted`, `write.refused`,
`write.conflicted`, `premise.set`, `notification.dispatched`,
`notification.acknowledged`, `notification.failed`, `run.closed`.

Actions: read, filter by kind, filter by agent, jump to its sequence.

### Agent

A name that wrote or was woken. An agent is not registered with xray; it is
observed. It exists across runs, which is the point of the agents view.

| Attribute | Notes |
| --- | --- |
| `name` | |
| `subscribes_to` | From the most recent registration |
| `writes_to` | From the most recent registration |
| `runs` | How many runs it appeared in |
| `writes`, `refusals` | Its record |
| `notifications`, `acks` | What it was asked and what it answered |
| `median_response` | Dispatch to acknowledgment |
| `unfinished_in` | Runs that closed while it still held a notification |

Actions: open, filter runs to this agent.

Relationships: appears in many Runs, is the subject of many Events.

### Region

A named part of a board, of one of two kinds. Scoped to a run, because two runs
may declare different regions.

| Attribute | Notes |
| --- | --- |
| `name` | |
| `kind` | `level` or `premise` |
| `writes` | How many landed here |
| `version` | Premises only, the current one |

Actions: filter a run's events to this region.

### Project

One deployment, and the unit an API key belongs to. An operator watching two
environments has two projects.

| Attribute | Notes |
| --- | --- |
| `name`, `slug` | |
| `keys` | Each with a prefix, a created date, and a last-used date |

## What is deliberately not an object

**A notification is not an object.** It is two events, a dispatch and an
acknowledgment, joined by an identifier. Making it an object would create a third
place where its state lives and a fourth where that state goes stale. The join
happens in the query.

**A contribution is not an object.** It is the body of a `write.admitted` event.
The board holds the contribution; xray holds the record that it was admitted.
Duplicating the board's own storage here would make xray a second source of truth
for something the store already answers.

## Navigation map

Four destinations, flat. No nesting beyond a run's own detail.

```
Overview            /                  is anything wrong
Runs                /runs              find the run I mean
  Run detail        /runs/:boardId     what happened, in order
Agents              /agents            which agent misbehaves
  Agent detail      /agents/:name      across every run
Settings            /settings          projects and keys
```

The runs list is the front door for a returning operator and the overview is the
front door for one arriving cold. Both are one click apart, so the ordering of the
nav is the only thing that decides which is default, and Overview is first.

## Open questions

None blocking. Two noted for later:

- Whether a run should be comparable against another run side by side. Deferred
  until an operator asks for it, since the object model already supports it.
- Whether projects need per-key scoping to a subset of boards. Not built, because
  one deployment sending to one project is the case that exists.
