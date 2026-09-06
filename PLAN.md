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
| P1 | `docs/product.md`, the durable product context Impeccable reads | done |
| P2 | Stage 2 object model and navigation map, `docs/docs/design/objects.md` | done |
| B1 | The event vocabulary: one frozen dataclass per event, tolerant JSON | done |
| B2 | Postgres schema: projects, keys, runs, events, and the read views | done |
| B3 | Ingestion: bearer token, batch, idempotent by event id | done |
| B4 | Query API: runs, one run, its events, agents, regions, statistics | done |
| B5 | The FastAPI application, serving the API and the built UI | done |
| S1 | The client: bounded queue, background worker, batch, retry, never raise | done |
| S2 | `Xray.create_model`, wrapping control, agents and the outcome | done |
| S3 | `Xray.as_agent` and the remote client wrapper | done |
| D1 | Stage 1 brand stance, `docs/docs/design/brand.md` | done |
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

## Decisions that are settled

Answered by the maintainer on 2026-09-06. Recorded with what was turned down,
because a decision whose alternatives are forgotten is one that gets reopened
by whoever reads the code next and thinks of the obvious other way.

| Question | Settled on | Turned down, and why it stays turned down |
| --- | --- | --- |
| Tenancy | Organizations own projects, Langfuse parity | Flat projects with one workspace. Simpler, and adequate for one company running one instance, but the org layer cannot be retrofitted without rewriting every URL and every permission check |
| Sign in | Email and password only | Adding OIDC in the first release. It is what a corporate install eventually wants, and it roughly doubles the authentication work and needs a real provider to test against. It is additive later and breaks nothing |
| Email | No SMTP. Invites and resets are one time links an admin copies | Requiring SMTP. It makes every self hoster configure mail before a second person can sign in, and makes delivery a support burden |
| Release | Self hosted the way Langfuse does it: clone and compose, a published image, the client on PyPI, and documentation | Publishing nothing yet, or shipping the image without the client |

Two things follow from the first row and are worth stating so they are not
rediscovered as problems. A project slug is unique inside its organization and
not across the install, so two teams may both have a project called
production. And a project is named in a URL by an opaque public identifier
rather than by its slug, because the slug is no longer unique and a serial
would say how many projects exist.

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
| U7 | The unauthenticated shell: sign in, first run, accept an invite | done |
| U8 | The organization and project switcher, and the account menu | done |
| U9 | Project settings: keys created and shown once, revoked, and retention | done |
| U10 | Organization settings: members, roles, and invite links to copy | done |
| U11 | The account: name, password, and every session with a way to end it | done |
| U12 | Every existing surface scoped to the project in the address | done |
| P1 | Retention. A per project window, chunked deletes, one sweeper however many replicas | done |
| P2 | Ingest limits: per key rate, payload ceiling, and a 429 the client already knows how to obey | done |
| P3 | Graceful shutdown, and a request identifier through every log line. Liveness against readiness is already built: `/api/v1/health` answers whether the process runs and `/api/v1/ready` whether it can serve, because an orchestrator restarts one and drains the other | done |
| P4 | An audit trail of who changed what, because a role change nobody can attribute is a role change nobody can review | done |
| R1 | release-please, conventional titles, one place the version lives | done |
| R2 | A multi architecture image on every tag, and a compose file that runs the whole platform from a clone | done |
| R3 | The client on PyPI, published by the workflow rather than by a person | done |
| R4 | The documentation a stranger needs: quickstart, every environment variable, upgrading, backup and restore, the security model, and the volume ceiling | done |
| R5 | An upgrade test: raise a database written by the previous version and assert the record survived | done |

## Where things stand

Every row is done.

The platform is a clone and one command. `docker compose up -d` brings up
Postgres and the server, and the first screen makes an owner, an organization,
a project and a key. A release tags itself from the commit subjects on main,
builds a two architecture image to GHCR, and publishes the client to PyPI by
trusted publishing rather than by a token somebody pasted into a secret.

What is deliberately not built, and why, is at the end of
`docs/self-hosting.md`: no encryption at rest, no backfill of dropped events,
rate limiting that is per process, and one Postgres rather than four stateful
services.

The container image cannot be built on this machine, because the registry is
not reachable from it. It is built by the `compose` job in CI, which brings the
whole stack up and walks the quickstart against it, and **that job passes**. So
the image builds, the interface is served from it, and the first run screen
makes a key that ingests, all verified somewhere other than here.

The interface is done and scoped: a project is in the path, everything under
`/p/:projectId` needs a session, and the three screens before a session
(`/signin`, `/setup`, `/join/:token`) are the only ones that answer without
one.

To run the whole thing:

```
createdb blackboardxray
BLACKBOARDXRAY_DATABASE_URL=postgresql://localhost/blackboardxray \
  .venv/bin/python -m blackboardxray.server serve
```

Then open it and the first run screen makes the owner, an organization, a
project and a key. To verify without a browser, `tests/test_onboarding.py`
walks the same path.

The suite needs a database and skips every test that touches one without it:

```
createdb blackboardxray_test
BLACKBOARDXRAY_TEST_DSN=postgresql://localhost/blackboardxray_test make verify
```

## Becoming a repository

The platform works. What is missing is everything that makes a stranger trust
it enough to run it: no remote, no release, no way to report a vulnerability,
no statement of what a contribution has to look like, and no automated check
that a dependency has not gone bad.

The standard is the one `blackboard` already holds itself to, because the same
person maintains both and two repositories with different rules is two sets of
rules to remember. What differs is what this project has and that one does not:
a container image, an interface with its own toolchain, and a database.

One rule carries over and is worth restating. **A pull request body carries no
parenthesis.** The squash merge writes the body into the commit message,
release-please parses that message, and a parenthesis defeats its parser
silently: the commit is dropped from the release notes while every check stays
green.

## Steps to a repository

| # | Step | Status |
| --- | --- | --- |
| G1 | The branch is `main`, the remote is set, and the history is pushed. Every workflow triggers on `main` and none of them has ever run | done |
| G2 | `uv.lock`, so CI and a contributor install the same versions rather than whatever resolved that morning | done |
| G3 | `CONTRIBUTING.md`: the change flow as it actually runs, the parenthesis rule, and how to run a database backed test | done |
| G4 | `SECURITY.md`: what is in scope, where to send a report privately, and what this platform deliberately does not defend against | done |
| G5 | `CODE_OF_CONDUCT.md`, Contributor Covenant, with a real address on it | done |
| G6 | Issue templates for a bug and a feature, and a config that points a question at Discussions rather than at the issue tracker | done |
| G7 | A pull request template that asks for the three things a review needs and refuses the parenthesis before CI does | done |
| G8 | Dependabot over four ecosystems: uv, npm, github-actions and docker. The interface has its own tree and is otherwise never updated | done |
| G9 | `title-lint`: conventional titles, no parenthesis in the body, and a breaking title carrying its migration | done |
| G10 | CodeQL over Python and TypeScript, dependency review on every pull request, `pip-audit` and `npm audit` in CI, and gitleaks | done |
| G11 | `.editorconfig`, `.gitattributes` marking generated files, and `.pre-commit-config.yaml` running the same gates CI runs | done |
| G12 | Repository settings and labels, applied with `gh` rather than clicked | done |
| G13 | The README a stranger reads: what it is, what it looks like, and running it in three lines | done |
| G14 | `docs/`: architecture, the API surface, the security model, and an ADR for each decision already made | done |
| G15 | Build provenance on the image and a software bill of materials, so somebody can verify what they pulled | done |

## Steps to a release

| # | Step | Status |
| --- | --- | --- |
| X1 | CI green on `main`, including the compose job that has never run anywhere | |
| X2 | The release pull request release-please opens, merged, tagging `0.1.0` | |
| X3 | The image on GHCR, pulled and run from the registry rather than from a build | |
| X4 | The client on PyPI by trusted publishing, installed from the index into a clean environment | |
| X5 | The quickstart walked from a clone nobody has touched, against the published image | |

## Rules for every step

- No value is set on a screen. A screen needing one is a token gap, closed in the
  token layer.
- No raw hex, no arbitrary Tailwind value, no pixel literal in `ui/src`.
- Zero em dashes in any prose, any label, any comment.
- Every claim in the documentation is checked against the code that runs.
- The library `blackboardx` is not edited.
