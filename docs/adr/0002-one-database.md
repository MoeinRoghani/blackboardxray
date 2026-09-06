# 2. One Postgres, not four stateful services

Date: 2026-09-06
Status: accepted

## Context

Langfuse, the model for this platform's mechanism, self-hosts as Postgres plus
ClickHouse plus Redis plus object storage. Four stateful services, each of which
has to be run, backed up, upgraded and reasoned about during an incident.

That architecture follows from what Langfuse stores: LLM traces whose payloads
are large, whose analytics are heavy, and which arrive faster than a
transactional database wants to write them.

## Decision

One Postgres. No cache, no queue, no object store, and no separate analytics
engine.

The events recorded here are small structured rows. A run produces tens to
hundreds of them, each a few hundred bytes plus its body. The index reads are a
single aggregate over a project's runs rather than a scan over its events,
because the run row carries denormalised counters written in the same
transaction as the events that move them.

## Consequences

**The operational cost is one service.** `docker compose up` is two containers,
one of which is Postgres, and the only thing holding state is the only thing to
back up.

**There is a ceiling and it is documented rather than hidden.** A project doing
a few hundred runs an hour is unremarkable. At tens of millions of events the
event table is where to look first: retention, then partitioning
`xray_events` by month. Reaching for ClickHouse is a decision to take when that
is not enough, and not before.

**Rate limiting is per process**, because the alternative is a round trip to a
shared store on the hottest path in the platform. With several replicas each
holds its own bucket. It is a fairness mechanism against a misconfigured
client, not a defence against a determined sender, and it says so.
