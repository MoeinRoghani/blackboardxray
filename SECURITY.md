# Security

## Reporting a vulnerability

Use [GitHub's private vulnerability
reporting](https://github.com/MoeinRoghani/blackboardxray/security/advisories/new).
It is private to the maintainer until an advisory is published.

If that is unavailable to you, email **moein.roghani@proton.me** with
`blackboardxray` in the subject.

Please do not open a public issue for a vulnerability. Please do not test
against somebody else's deployment.

**What to expect.** An acknowledgement within three working days, an assessment
within ten, and a fix released before the advisory is published. One
maintainer, so those are honest targets rather than a service level agreement.
You will be credited in the advisory unless you would rather not be.

## Supported versions

The latest minor release. While the major version is `0`, a fix goes into the
next minor release rather than being backported.

## What is in scope

The server, the client, the container image and the interface in this
repository. In particular:

- Anything that lets a request read a project the caller is not a member of.
- Anything that lets somebody act above their role, or grant themselves one.
- Anything that recovers a password, an API key, an invitation or a session
  token from what the database stores.
- Anything that lets an application's key read or write outside its own
  project.
- Cross site request forgery against the interface, or session fixation.
- SQL injection, and anything that escapes the parameterised statements.

## What is not a vulnerability here

These are known, deliberate, and documented at the end of
`docs/self-hosting.md`. A report about one of them is a design disagreement,
which is welcome as an issue and is not an advisory.

**Contributions are stored as they arrived.** The platform does not encrypt at
rest. It records what your application chose to send, so a deployment that must
not store contributions passes `content_limit=0` and the platform records the
size and shape and none of the value. Give it its own database.

**Reading is open to whoever holds an account.** Authorization is per project
and per role; there is no row level or field level policy beyond a viewer not
seeing contribution content.

**Rate limiting is per process.** With several replicas each holds its own
bucket, so the effective limit is the configured one times the number of
replicas. It is a fairness mechanism against a misconfigured client, not a
defence against a determined sender.

**A denial of service from an authenticated, authorised client.** Somebody who
holds a valid key can send until the disk is full. The key is issued by you and
revoked by you.

**Anything requiring database access.** Whoever can read the Postgres this
platform sits on has already won; nothing here is designed to survive that.

## How credentials are stored

| Credential | Stored as |
| --- | --- |
| Password | scrypt, `n=2^15, r=8, p=1`, per user salt, tagged with its cost so the cost can be raised without locking anybody out |
| Session token | SHA-256 digest of an opaque 256 bit random value |
| API key | SHA-256 digest, with the first twelve characters kept in the clear so a person can tell two keys apart |
| Invitation token | SHA-256 digest, expiring after seven days, spent once |

A leaked database dump yields no session, key or invitation anybody can use,
and no password without paying scrypt per guess. It does yield whatever your
contributions contained.

The platform holds no third party credential and therefore has nothing to
encrypt: **there is no secret for a deployment to generate, rotate or lose.**

## How the session works

An opaque random token in a cookie marked `HttpOnly`, `SameSite=Lax`, and
`Secure` when the request arrived over HTTPS or a proxy said it did. Every
unsafe method that carries a session also has its `Origin` checked, so a cross
site request is refused even from a subdomain that `SameSite=Lax` would allow.
Ingestion is exempt from that check because it authenticates with a bearer
token, which a cross site request cannot forge, and because the sending client
is a Python process that sends no `Origin` at all.

Signing out deletes the session. Changing a password deletes every session.

## Hardening a deployment

- Put it behind whatever already fronts your internal tools, and forward
  `X-Forwarded-Proto` so the cookie is marked `Secure`.
- Leave `BLACKBOARDXRAY_ALLOW_SIGNUP` off unless the server is reachable by
  exactly the people who should have accounts.
- Give the platform its own Postgres role and database.
- Set a retention window per project, so a leak of an old backup is a leak of
  less.
