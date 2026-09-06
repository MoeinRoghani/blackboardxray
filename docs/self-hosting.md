# Running blackboardxray yourself

One server, one database, one interface. Two containers and nothing else.

## Quickstart

```
git clone https://github.com/MoeinRoghani/blackboardxray
cd blackboardxray
docker compose up -d
```

Open <http://localhost:8900>. The first screen makes your account, an
organization, a project, and a key an application can send with. It is offered
once: after somebody exists, everybody else arrives by invitation.

That runs the published image. The tag `0` follows the major line and gets
fixes without you reading release notes; pin `0.1.0` instead if you would
rather decide each time, or swap the `image:` line for `build: .` to run the
working copy.

The image is built for `linux/amd64` and `linux/arm64` and carries a signed
provenance attestation and a bill of materials, so you can ask what is in it
and who built it:

```
gh attestation verify oci://ghcr.io/moeinroghani/blackboardxray:0 \
  --owner MoeinRoghani
docker buildx imagetools inspect ghcr.io/moeinroghani/blackboardxray:0
```

## What it needs

**Postgres 14 or later.** That is the whole list. There is no cache to run, no
queue, no object store, and no secret for you to generate: sessions are opaque
identifiers held in Postgres, and every credential, key and invitation is
stored as a digest. Postgres is the only thing holding state, so it is the only
thing to back up.

The schema is applied when the server opens the database. Replicas take an
advisory lock first, so starting four containers at once applies each migration
once.

## Configuration

Everything is an environment variable. Only the first is required.

| Variable | Default | What it does |
| --- | --- | --- |
| `BLACKBOARDXRAY_DATABASE_URL` | none | Where the record is kept. There is no default, because a monitoring platform whose database is a guess silently watches nothing |
| `BLACKBOARDXRAY_HOST` | `127.0.0.1` | The address to bind. The container sets `0.0.0.0` |
| `BLACKBOARDXRAY_PORT` | `8900` | The port to bind |
| `BLACKBOARDXRAY_ALLOWED_ORIGINS` | none | Origins the interface is served from, comma separated. Needed only when it is reached at a different hostname than the API |
| `BLACKBOARDXRAY_ALLOW_SIGNUP` | `false` | Whether a stranger who reaches the sign in page may make an account |
| `BLACKBOARDXRAY_INGEST_RATE` | `2000` | Events per second one key may send, sustained |
| `BLACKBOARDXRAY_INGEST_BURST` | `20000` | What one key may send in one go after being quiet |

### Provisioning without a browser

A deployment nobody is going to open can be given its first everything. Each is
created only where it is absent, so restarting does not undo a change somebody
made afterwards.

| Variable | What it makes |
| --- | --- |
| `BLACKBOARDXRAY_INIT_ORG_SLUG` | The organization, if there is not one by that slug |
| `BLACKBOARDXRAY_INIT_ORG_NAME` | What to call it |
| `BLACKBOARDXRAY_INIT_PROJECT_SLUG` | The project inside it |
| `BLACKBOARDXRAY_INIT_PROJECT_NAME` | What to call that |
| `BLACKBOARDXRAY_INIT_USER_EMAIL` | The account that owns the organization |
| `BLACKBOARDXRAY_INIT_USER_PASSWORD` | Its password, at least ten characters |
| `BLACKBOARDXRAY_INIT_USER_NAME` | Their name |
| `BLACKBOARDXRAY_INIT_API_KEY` | The key an application will send with |

The key is the one value you supply rather than the platform generating it. A
key invented on boot would be printed into a log and then be unreadable for
ever, and the application that needs it is configured from the same file these
came from. Generate one yourself, prefixed `bxr_`:

```
echo "bxr_$(openssl rand -hex 24)"
```

## Behind a proxy

Terminate TLS wherever you already do. Two headers matter:

- `X-Forwarded-Proto`, so the session cookie is marked `Secure`. Without it a
  deployment behind TLS termination sees plain HTTP and never sets the flag.
- `X-Forwarded-For`, so a sign in is recorded against the address it came from
  rather than against the proxy.

If the interface is served from a different hostname than the API, list that
origin in `BLACKBOARDXRAY_ALLOWED_ORIGINS`. It is an explicit list and never a
wildcard, because a session travels as a cookie and a permitted origin is
allowed to send it.

## Health

Two endpoints, and they answer different questions.

| Path | Answers | Use it for |
| --- | --- | --- |
| `/api/v1/health` | Is this process running | Liveness. A failure here should restart the container |
| `/api/v1/ready` | Can this process serve a request | Readiness. A failure here should stop sending it traffic |

Pointing both at the same check turns a database outage into a restart loop.

## Backup and restore

Postgres holds everything.

```
docker compose exec -T postgres pg_dump -U blackboardxray blackboardxray \
  | gzip > blackboardxray-$(date +%F).sql.gz
```

To restore into an empty database:

```
gunzip -c blackboardxray-2026-09-06.sql.gz \
  | docker compose exec -T postgres psql -U blackboardxray blackboardxray
```

A dump holds hashed passwords, hashed keys and hashed session tokens, so a
leaked dump yields no credential anybody can use. It also holds whatever your
contributions contained, in the clear, which is the thing to think about when
deciding where dumps live. A project that must not store contributions sends
`content_limit=0` and the platform records the size and shape and none of the
value.

## Upgrading

```
docker compose pull && docker compose up -d
```

Migrations run on start. A database holding a migration the running build does
not ship is refused at the door rather than half read, so a rollback needs a
restore from before the upgrade. Take the dump first.

There is a test for this: `tests/test_migrate.py` raises a database written at
the first migration, with a project, a key and a run in it, and asserts all
three survive.

## Retention

Nothing is deleted until a project says so. Set a window in the project's own
settings and runs older than it are removed, in chunks, by one replica holding
an advisory lock. What is deleted does not come back.

## What this does not do

**It does not encrypt what it holds.** A contribution recorded here sits in
Postgres as it arrived. Give the platform its own database and back it up like
one holding production data.

**A dropped event leaves a hole nothing repairs.** The sending client's queue
is bounded, so a platform that is down loses events rather than stalling a run.
Nothing backfills them afterwards. That is the right trade for telemetry and it
means the record is not evidence.

**Rate limiting is per process.** With several replicas each holds its own
bucket, so the effective limit is the configured one times the number of
replicas. It is a fairness mechanism against a misconfigured loop, not a
defence against an attacker.

**It never writes to a run.** Every path here reads. The SDK wraps the control
component to watch it and has no route by which an observer could admit a write
or close a board.

## How much it holds

One Postgres, and the ceiling is Postgres's. As a rough shape: an event is a
row of a few hundred bytes plus its body, a busy run produces tens to hundreds
of events, and the index reads are a single aggregate over a project's runs
rather than over its events.

A project doing a few hundred runs an hour is unremarkable. At tens of millions
of events the event table is where to look first: set a retention window, and
if that is not enough, partition `xray_events` by month. Langfuse reaches for
ClickHouse because it stores LLM traces whose payloads are large; these are
small structured rows and the same reach is not warranted.

## Getting back in

If nobody can sign in, the command line is the way back. It talks to the
database directly and does not need the server running.

```
docker compose exec xray blackboardxray owner you@example.com "Your Name"
docker compose exec -it xray blackboardxray password you@example.com
docker compose exec xray blackboardxray key acme production "ci"
```

`owner` makes an account and gives it ownership of the default organization,
and is safe on an install that already has people. `password` sets a new one
on an account that exists and ends every session it had. `key` issues a key
for one project and prints it once.

**`password` is the only way back for somebody who has forgotten theirs.**
This platform sends no mail, so there is no link to send, and an invitation to
an address that already has an account asks for that account's password, which
is exactly what has been lost. It is deliberately not in the interface: an
admin who could set somebody else's password would have every account in the
organization inside their reach, including an owner's. Whoever can reach the
database can already read everything, so that is the level this belongs at and
the only one that grants nothing new.

Note `-it`, which the other two do not need: it prompts for the password
rather than taking it as an argument that would land in your shell history.
