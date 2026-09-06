# Contributing

Thank you for looking. This is a small project with one maintainer, so the
process is short and the standards are specific.

## Before you write code

Open an issue first for anything that is not a small fix. A pull request that
arrives without one may be solving a problem this project has decided not to
have, and finding that out afterwards wastes your afternoon rather than five
minutes of conversation.

Bug reports do not need an issue first. Send them straight in.

## Getting it running

You need Python 3.11 or later, Node 20 or later, and a Postgres you can create
databases in.

```
make setup
createdb blackboardxray_test
BLACKBOARDXRAY_TEST_DSN=postgresql://localhost/blackboardxray_test make verify
```

**`make verify` skips every database test when `BLACKBOARDXRAY_TEST_DSN` is
unset, and says so rather than failing.** A green run without it has checked
about a third of what there is. CI always names one.

To see the interface against real data:

```
createdb blackboardxray
export BLACKBOARDXRAY_DATABASE_URL=postgresql://localhost/blackboardxray
make ui && make serve
```

Open <http://localhost:8900>, set it up, then put a day of traffic in it:

```
BLACKBOARDXRAY_TOKEN=bxr_... make backfill
```

## The change flow

1. Branch from `main`. Name it `<type>/<slug>`, as `fix/lock-leak`.
2. **Write the test first.** It must fail against the unmodified code. A test
   written afterwards checks that the code does what it does.
3. Implement.
4. `make verify` locally, with a database named. Green locally is the condition
   for opening a pull request, not a substitute for CI.
5. Open the pull request with a Conventional Commit title and `Closes #N` in
   the body.
6. Merge when CI is green. A pull request whose CI is red is never merged,
   whatever the reason for the failure.

## Two rules about the pull request body

**No parentheses.** The squash merge writes the body into the commit message
and release-please parses that message. A parenthesis defeats its parser and
the failure is silent: the commit is dropped from the release notes while every
check stays green. Commas, semicolons and separate sentences carry the same
meaning. A workflow checks this.

**A breaking change carries both a `!` in the title and a `BREAKING CHANGE:`
footer stating the migration.** Not either. Without the footer the release says
a break happened and never says how to migrate.

## What the gates refuse

Six, all in CI, and all runnable locally.

| Gate | Refuses |
| --- | --- |
| `ruff` and `mypy --strict` | Unformatted, unlinted or untyped Python |
| `pytest` | A behaviour that changed without a test noticing |
| `npm run check` | Any hex, rgb, px, rem or arbitrary Tailwind value in `ui/src` |
| `npm run contrast` | Any of forty-nine read pairs below its floor, in either theme |
| `tsc` | A body field read off the wrong event kind |
| `pytest tests/test_wire_mirror.py` | An event kind named in Python and forgotten in TypeScript |

The interface gates are the unusual ones. **A screen may not set a value.**
Colours, spacing, radii and type all come from the token layer, and a screen
that needs something the system lacks is a gap in the system: add the token,
then use it. `docs/design-system.md` says why, and how the three tiers work.

## Writing

The prose in this repository, including code comments and commit messages, is
held to the same standard as the code.

- Say what a thing does and why it is that way. A comment restating the line
  below it is noise.
- Avoid em dashes. Commas, semicolons and separate sentences.
- Use the vocabulary of the blackboard architecture literature: a run, a board,
  a region, an agent, an admission rule. Not traces, spans or users.
- No motivational filler and no generic conclusion.

## Reporting a vulnerability

Not here. `SECURITY.md` says where.
