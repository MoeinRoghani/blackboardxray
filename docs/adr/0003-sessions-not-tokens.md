# 3. Opaque sessions in the database, not signed cookies

Date: 2026-09-06
Status: accepted

## Context

A web application needs to know who is asking. The two usual answers are a
signed cookie or a JSON web token carrying claims, and a server-side session
identified by an opaque cookie.

A signed cookie needs a signing secret. Langfuse requires three of them:
`NEXTAUTH_SECRET`, `SALT` and `ENCRYPTION_KEY`. Each is a thing a self-hoster
must generate, store, rotate and not lose, and losing one is either a mass
sign-out or a mass unlock.

## Decision

A session is a 256 bit random value in a cookie. The database holds its SHA-256
digest, its expiry, when it was last seen, and the browser and address it was
made from.

## Consequences

**There is no secret for a deployment to generate.** Nothing here is signed,
because nothing here is self-describing. The platform also stores no third
party credential, so it has nothing to encrypt at rest either.

**Revocation is a delete.** Signing out ends that session. Changing a password
ends every session, which is the right behaviour because the usual reason to
change one is believing somebody else has it. A stateless token cannot do
either without a revocation list, which is a session table with extra steps.

**Somebody can see where they are signed in**, and end the others. That list is
a thing a platform holding a company's operational record ought to be able to
answer.

**It costs one indexed read per request.** The row is touched at most once
every thirty minutes rather than on every request, because updating a last-seen
column on every read turns a dashboard into a write workload.
