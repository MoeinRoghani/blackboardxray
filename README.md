# blackboardxray

**Self-hosted observability for [blackboardx](https://github.com/MoeinRoghani/blackboard)
runs.** One server, one database, one interface. An application reaches it by
naming an endpoint and a token, and nothing else about the application changes.

[![CI](https://github.com/MoeinRoghani/blackboardxray/actions/workflows/ci.yml/badge.svg)](https://github.com/MoeinRoghani/blackboardxray/actions/workflows/ci.yml)
[![security](https://github.com/MoeinRoghani/blackboardxray/actions/workflows/security.yml/badge.svg)](https://github.com/MoeinRoghani/blackboardxray/actions/workflows/security.yml)
[![PyPI](https://img.shields.io/pypi/v/blackboardxray)](https://pypi.org/project/blackboardxray/)
[![Python](https://img.shields.io/pypi/pyversions/blackboardxray)](https://pypi.org/project/blackboardxray/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

A blackboard run is a set of agents writing to a shared board under an
admission rule. When one goes wrong the board tells you what was written, and
nothing tells you what the run *did* about it: who was notified, who
acknowledged, what admission refused, or which delivery never arrived. This
records that.

**Two containers and nothing else.** No cache, no queue, no object store, and
no secret for you to generate.

## Contents

- [Why it exists](#why-it-exists)
- [Run it](#run-it)
- [Observe a run](#observe-a-run)
- [What is recorded](#what-is-recorded)
- [Who can see what](#who-can-see-what)
- [Seeing it with something in it](#seeing-it-with-something-in-it)
- [What the interface shows](#what-the-interface-shows)
- [Development](#development)
- [Self-hosting reference](docs/self-hosting.md)
- [Security](SECURITY.md) and [Contributing](CONTRIBUTING.md)

## Why it exists

`blackboardx` makes the record durable and leaves the run in the process. The
store holds the regions, the contributions, the premise versions, the sequence,
the two deadlines and the outcome. It does not hold who was notified, who
acknowledged, what admission refused, or which delivery failed, and the
library's logging rule forbids logging any of them on the grounds that the agent
already saw them.

So the record is observable and the run is not. That is what this is for.

## Run it

```
git clone https://github.com/MoeinRoghani/blackboardxray
cd blackboardxray
docker compose up -d
```

Open <http://localhost:8900>. The first screen makes your account, an
organization, a project, and a key to send with. Everybody after you arrives by
an invitation link, because this platform has no mail server and does not want
one.

Two containers and nothing else. No cache, no queue, no object store, and no
secret to generate: sessions are opaque identifiers held in Postgres and every
credential is stored as a digest. Postgres is the only thing holding state, so
it is the only thing to back up.

To build it here instead of pulling it, which is also what to do from a
network that intercepts TLS and leaves Docker unable to verify ghcr.io:

```
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Without Docker:

```
pip install 'blackboardxray[server]'
createdb blackboardxray
export BLACKBOARDXRAY_DATABASE_URL=postgresql://localhost/blackboardxray
blackboardxray serve
```

Every environment variable, the proxy headers that matter, backup, upgrading
and the volume ceiling are in [docs/self-hosting.md](docs/self-hosting.md).

## Observe a run

```python
from blackboardxray import Xray

xray = Xray(endpoint="http://localhost:8900", token="bxr_...")  # the key from setup

model = xray.create_model(
    board_id="incident-4471",
    store=SqliteStore("incidents.sqlite3"),
    regions=[Level("platform"), Premise("window")],
    premises={"window": ["20:00", "22:00"]},
    agents=[Agent(name="ocp", notify=investigate)],
    limits=RunLimits(wall_clock=timedelta(minutes=10), idle=timedelta(seconds=30)),
)
```

Every argument is the one `blackboard.create_model` takes and means the same
thing. What comes back is the library's own model. The library is not modified
and is not asked to grow a hook.

An agent deployed as its own service wraps its board instead:

```python
board = xray.agent_board(BoardClient(base_url=..., board_id=..., agent="ocp"))
```

## Seeing it with something in it

An empty platform demonstrates nothing. Put a day of fabricated traffic in,
using the key the setup screen gave you:

```
BLACKBOARDXRAY_TOKEN=bxr_... python3 examples/backfill.py 24 40
```

Roughly six hundred runs and twelve thousand events, in about ten seconds, with
a working day's shape and an incident spike in the middle. It needs nothing
installed: the script imports only the standard library and nothing newer than
Python 3.7, because it is the one file somebody runs before installing
anything.

The wire and the vocabulary are real and only the clock is invented, so nothing
here runs in a deployment.

## What is recorded

Ten kinds, in the blackboard's own vocabulary.

| Kind | When |
| --- | --- |
| `run.opened` | A model was created, with its regions, premises and limits |
| `agent.registered` | An agent joined, at creation or afterwards |
| `write.admitted` | A level write passed admission and reached the board |
| `write.refused` | A write was refused, with the cause and the rule's reason |
| `write.conflicted` | A premise write named a version no longer current |
| `premise.set` | A premise write reached the board |
| `notification.dispatched` | A notification left for one agent |
| `notification.acknowledged` | An agent reported it had stopped |
| `notification.failed` | Delivery raised, so the agent never received it |
| `run.closed` | The run closed, with its outcome and who did not finish |

A contribution's content is recorded, truncated past 4kB. A deployment whose
contributions may not leave the process passes `content_limit=0`, which records
the size and the shape and none of the content.

## Who can see what

An organization owns projects. A person is a member of an organization with a
role, and a role on one project replaces it in either direction: it raises a
member to admin on the project they run, and it is how somebody given `none` at
the organization gets exactly one project and nothing else.

| Role | May |
| --- | --- |
| `owner` | Everything, including deleting the organization |
| `admin` | Projects, keys and people. Cannot touch owners |
| `member` | Read every run, including what was written |
| `viewer` | Read what happened, and not what was written |
| `none` | Nothing, except a project they were given explicitly |

A viewer is the one worth explaining. A contribution is your application's own
data and may hold anything it is allowed to hold, so the lowest role that can
be handed out sees that four kilobytes of an object were admitted at sequence
nine, and not what was in it.

## What the interface shows

`blackboardxray serve` serves the interface at the same address as the API.

**Boards**, at `/p/<project>`, is a chart of runs opened per interval over the record of
them. Clicking a bar narrows the table to the runs that bar counted; the facet
strip between them narrows by outcome, by agent, or to the runs an agent did
not finish, and each facet carries the count it would leave. Selecting a board
opens a panel beside the list with what happened inside it: which agent was
refused, on which region, and what the rule said.

**A board**, at `/p/<project>/boards/<board_id>`, reads three ways. *Graph* draws what
wrote to what and who was told, with a broken edge where a notification never
arrived. *Events* is the same run as a table and is the record. *Board* is what
was actually written. The run's own clock stays along the bottom of all three.

Every filter, the time window, the selected board and the chosen view are in
the address, so a view is a link.

Reading needs an account. Ingestion needs a key. The two are separate doors:
an application holds a key and may only write, and a person holds a session and
may only read.

## Development

```
make setup
make verify
```

`make verify` needs a database and skips every test that touches one without
it, so name one:

```
createdb blackboardxray_test
BLACKBOARDXRAY_TEST_DSN=postgresql://localhost/blackboardxray_test make verify
```

`examples/seed.py` runs real models through the real client. `examples/backfill.py`
posts a day of fabricated traffic over the ingest API, so the interface can be
looked at at the volume it is for; it is a fixture and nothing in a deployment
runs it.

## Documentation

| | |
| --- | --- |
| [Self-hosting](docs/self-hosting.md) | Every environment variable, proxy headers, backup and restore, upgrading, and the volume ceiling |
| [Architecture](docs/architecture.md) | The two halves, the wire between them, and what runs in the background |
| [Decisions](docs/adr/) | Why one database, why sessions rather than tokens, why links rather than email |
| [Security](SECURITY.md) | How credentials are stored, what is in scope, and what this deliberately does not defend against |
| [Contributing](CONTRIBUTING.md) | The change flow, the gates, and the two rules about a pull request body |
| [Design system](docs/design-system.md) | The token pipeline, the depth ladder, and why a screen may not set a value |
| [Limits](docs/limits.md) | What the client does when the platform is down or slow |

## Status

Version 0.x. The public surface may still change, and a breaking change carries
a `!` and a migration note in its release. The wire format between the client
and the server is versioned separately and decodes tolerantly in both
directions, so a client and a server from different releases work together.

## License

Apache-2.0. See [LICENSE](LICENSE).
