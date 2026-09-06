# 1. What this project is, and what it is not

Date: 2026-09-05
Status: accepted

## Context

`blackboardx` implements the skeletal blackboard system: a board, a control
component, and the configuration through which an application supplies its
regions, agents, admission rule, termination predicate and budgets. It makes
the record durable and leaves the run in the process.

The store holds regions, contributions, premise versions, the sequence, the two
deadlines and the outcome. It does not hold who was notified, who acknowledged,
what admission refused, or which delivery failed. The library's logging
principle forbids logging any of them, on the grounds that the agent already
saw them, and `Control.read_audit`, the one name that held them, is deprecated
for removal.

So the record is observable and the run is not.

## Decision

A separate self-hosted platform, on Langfuse's mechanism: one server with its
own database and its own interface, that an application reaches by naming an
endpoint and a token.

**The library is not modified.** The SDK here wraps `Control`, `AgentBoard` and
each agent's `notify` callback at the application's boundary, so every write,
refusal, notification, acknowledgment and outcome passes through something that
can record it. Nothing is asked of `blackboardx` and no hook is added to it.

**The vocabulary is the blackboard literature's.** A run, not a trace. An
event, not a span or an observation. An agent, not a user. An outcome, not a
score. Langfuse's nouns are LLM-tracing nouns and none of them are used.

## Consequences

The client half declares no dependency, so an application already running a
blackboard adds this package and sends over the standard library.

The two halves are deployed separately and are therefore versioned separately.
The wire decodes tolerantly in both directions: an unrecognised field is
ignored, an absent field takes its default, and a name is never reused for a
different meaning.

Observation is at the application boundary, so a write that never reaches the
wrapped object is never recorded. This platform sees what the application did,
which is the thing it is for, and is not an audit of the library.
