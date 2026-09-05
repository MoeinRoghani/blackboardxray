# blackboardxray: build plan

Resume rule: read this file, find the first row not `done`, continue there. Never
pause between rows.

## What is being built

A self-hosted observability platform for blackboard runs, on the Langfuse
mechanism: a server you run yourself, with its own database and its own UI, that
an application reaches by naming an endpoint and a token. Nothing else about the
application changes.

The library it watches is `blackboardx`. The library is not modified. The SDK
here wraps `Control`, `AgentBoard` and each agent's `notify` callback at the
application's boundary, so every write, refusal, notification, acknowledgment and
outcome passes through something that can record it.

## Why it exists

`blackboardx` makes the record durable and leaves the run in the process. The
store holds regions, contributions, premise versions, the sequence, the two
deadlines and the outcome. It does not hold who was notified, who acknowledged,
what admission refused, or which batch window collapsed which burst. The logging
principle in that library forbids logging any of them, on the grounds that the
agent already saw them, and `Control.read_audit`, the one name that held them, is
deprecated for removal on or after 2026-12-05.

So the run is unobservable today. That is what this platform is for.

## Vocabulary

The blackboard literature already names all of this. Langfuse's nouns are
LLM-tracing nouns and none of them are used here.

| Not this | This |
| --- | --- |
| trace | run |
| span, observation | event |
| user | agent |
| session | project |
| score | outcome |

## Steps

| # | Step | Status |
| --- | --- | --- |
| P1 | `PRODUCT.md`, the durable product context Impeccable reads | done |
| P2 | Stage 2 object model and navigation map, `design/objects.md` | done |
| B1 | The event vocabulary: one frozen dataclass per event, tolerant JSON | done |
| B2 | Postgres schema: projects, keys, runs, events, and the read views | done |
| B3 | Ingestion: bearer token, batch, idempotent by event id | done |
| B4 | Query API: runs, one run, its events, agents, regions, statistics | done |
| B5 | The FastAPI application, serving the API and the built UI | done |
| S1 | The client: bounded queue, background worker, batch, retry, never raise | done |
| S2 | `Xray.create_model`, wrapping control, agents and the outcome | done |
| S3 | `Xray.as_agent` and the remote client wrapper | done |
| D1 | Stage 1 brand stance, `design/brand.md` | done |
| D2 | Stages 3, 4, 6, 7: primitive tokens | done |
| D3 | Stage 5 color, on Radix scales, contrast verified | done |
| D4 | Stage 8 assembly: semantic tier, both themes, the build | done |
| D5 | Stage 9 relationships, Stage 10 layout, Stage 11 buttons | done |
| U1 | The shell: navigation, theme, empty and error states | done |
| U2 | Runs index: the list, its filters, its empty state | done |
| U3 | Run detail: the sequence spine, the event stream, the agent lanes | done |
| U4 | Agents view: per-agent behaviour across runs | done |
| U5 | Overview: the statistics that answer "is anything wrong" | done |
| V1 | Seed a real run through the SDK against a real Postgres | done |
| V2 | Screenshot both themes, run the Impeccable detector, fix in one batch | done |
| V3 | Tests, `make verify`, docker compose, README, governance | done |

## Rules for every step

- No value is set on a screen. A screen needing one is a token gap, closed in the
  token layer.
- No raw hex, no arbitrary Tailwind value, no pixel literal in `ui/src`.
- Zero em dashes in any prose, any label, any comment.
- Every claim in the documentation is checked against the code that runs.
- The library `blackboardx` is not edited.
