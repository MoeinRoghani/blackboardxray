# 4. Invitations are links, not email

Date: 2026-09-06
Status: accepted

## Context

A multi-user platform has to get a second person into it. The usual mechanism
is an emailed invitation, which requires SMTP credentials, a sending domain,
and somebody to care about deliverability.

## Decision

An admin creates an invitation and copies a one-time link. Password reset works
the same way. The platform sends no mail and has no mail configuration.

## Consequences

**An install has no external dependency.** It comes up and works. An install
that needs a mail server configured before a second person can sign in is an
install that stays a single person's install.

**The link is a credential and travels however the admin already talks to their
colleagues.** It is stored as a digest, expires after seven days, and is spent
once: accepting it marks it accepted in the same statement that reads it, so a
link opened twice cannot make two memberships.

**There is no self-service password reset.** Somebody who is locked out asks an
admin, who removes and re-invites them, or uses the command line. That is worse
than an emailed reset and is the price of the paragraph above. SMTP can be
added later as an optional convenience without changing anything here.
