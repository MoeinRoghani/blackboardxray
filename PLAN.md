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
| W1 | The two aggregates the index needs: a continuous histogram and facet counts, with a half open time range threaded through every run query | done |
| W2 | The frame: a depth ladder of planes, bands welded to both edges, wells for the recesses, and the OKLab extension that gives a dark theme two rungs below Radix step 1 | done |
| W3 | Boards: the chart over the record, the facet strip that replaces the overview, the virtualised table, and the inspector beside it | done |
| W4 | A board: graph, events and contents, over one clock | done |
| W5 | Settings as a route, agents as a table, the sheet stack removed | done |
| W6 | The verification pass: detector, keyboard order, both themes, a phone, and a fixture with a day of traffic in it | done |

## What the interface is

Three destinations and one detail. The index is a query rather than a browse,
because a project opens runs continuously and holds thousands of them: a chart
of runs opened per interval, a facet strip that narrows the list and carries
the counts an overview would have, and a dense virtualised table under both.
Selecting a board opens a panel beside it. The graph is a reading of one run
and lives inside that run, never above the project.

Every filter, the window, the selection and the chosen view are search
parameters, so any view is a link.

## Becoming operational

Everything above makes one thing observable. None of it makes the platform
something a company can run: there are no people in it, reading is open to
whoever reaches the port, a project is created by shelling into the container,
and the schema has no way to gain a column.

The model is Langfuse's. An organization owns projects, a person is a member of
an organization with a role, an application authenticates with a key that
belongs to one project, and a reader authenticates as themselves.

Three deliberate departures.

**One database, not four.** Langfuse needs Postgres, ClickHouse, Redis and
object storage, because it stores LLM traces whose payloads are large and whose
analytics are heavy. These events are small structured rows. Postgres is
enough, and one stateful service is the difference between an install a team
can operate and one they cannot. The ceiling that buys is documented rather
than hidden.

**No secret to configure.** Langfuse requires `NEXTAUTH_SECRET`, `SALT` and
`ENCRYPTION_KEY`. Sessions here are opaque random identifiers stored hashed in
the database rather than signed cookies, keys and invite tokens are stored
hashed, and the platform holds no third party credential it would need to
encrypt. So there is nothing to generate and nothing to lose.

**No SMTP.** An invite is a one time link an admin copies and sends however
they already talk to their colleagues. A password reset is the same. An install
that needs a mail server before a second person can sign in is an install that
does not get a second person.

## Steps to operational

| # | Step | Status |
| --- | --- | --- |
| M1 | A numbered migration runner: an advisory lock, one transaction per file, and a checksum that refuses a migration edited after it ran | done |
| I1 | `users` and `sessions`, with scrypt hashing tagged by algorithm so the cost can be raised later without locking anyone out | done |
| I2 | Session lifecycle: opaque token hashed at rest, sliding expiry, revocation as a delete | done |
| I3 | The auth routes, the cookie, an origin check on every unsafe method, and a lockout that survives a restart | done |
| T1 | `organizations`, `memberships`, per project role overrides, `invites`, and a public identifier for every object a URL names | done |
| T2 | The migration that gives existing projects an organization to belong to | done |
| T3 | The role model, and `effective_role` where a project role beats an organization role | done |
| A1 | Every read authorized: a session, a membership, a role, and a 403 that says which | done |
| A2 | Keys gain revocation and a last used stamp that does not write on every request | done |
| A3 | The administration API: organizations, projects, keys, members, invites | done |
| O1 | First run. No users means one reachable page, which creates the owner, an organization, a project and the first key | done |
| O2 | Headless initialization from the environment, idempotent, for a compose file or a chart | done |
| O3 | Signup is invite only unless a deployment opens it | done |
| U7 | The unauthenticated shell: sign in, first run, accept an invite | |
| U8 | The organization and project switcher, and the account menu | |
| U9 | Project settings: keys created and shown once, revoked, and retention | |
| U10 | Organization settings: members, roles, and invite links to copy | |
| U11 | The account: name, password, and every session with a way to end it | |
| U12 | Every existing surface scoped to the project in the address | |
| P1 | Retention. A per project window, chunked deletes, one sweeper however many replicas | |
| P2 | Ingest limits: per key rate, payload ceiling, and a 429 the client already knows how to obey | |
| P3 | Liveness against readiness, graceful shutdown, and a request identifier through every log line | |
| P4 | An audit trail of who changed what, because a role change nobody can attribute is a role change nobody can review | |
| R1 | release-please, conventional titles, one place the version lives | |
| R2 | A multi architecture image on every tag, and a compose file that runs the whole platform from a clone | |
| R3 | The client on PyPI, published by the workflow rather than by a person | |
| R4 | The documentation a stranger needs: quickstart, every environment variable, upgrading, backup and restore, the security model, and the volume ceiling | |
| R5 | An upgrade test: raise a database written by the previous version and assert the record survived | |

## Rules for every step

- No value is set on a screen. A screen needing one is a token gap, closed in the
  token layer.
- No raw hex, no arbitrary Tailwind value, no pixel literal in `ui/src`.
- Zero em dashes in any prose, any label, any comment.
- Every claim in the documentation is checked against the code that runs.
- The library `blackboardx` is not edited.
