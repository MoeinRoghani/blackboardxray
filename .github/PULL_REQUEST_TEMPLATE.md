## What this changes

<!-- What is different afterwards, for somebody using this. One or two
     sentences. The title is the release note; this is the reason. -->

## Why

<!-- The problem. If there is an issue, say `Closes #N` and this can be short. -->

Closes #

## How it was checked

<!-- What you ran, and what a reviewer should run to see it. If this fixes a
     bug, name the test that failed before the change. -->

- [ ] `make verify` passes with `BLACKBOARDXRAY_TEST_DSN` set to a real database
- [ ] A test fails against the unmodified code and passes against this one
- [ ] The documentation this affects is updated in this pull request

---

<!--
Two things this body must satisfy, both checked by a workflow.

NO PARENTHESES. The squash merge writes this body into the commit message and
release-please parses that message. A parenthesis defeats its parser silently:
the commit is dropped from the release notes while every check stays green.
Commas, semicolons and separate sentences carry the same meaning.

A BREAKING CHANGE carries both a `!` in the title and a `BREAKING CHANGE:`
footer here, stating what changed and what a caller writes instead. Both, not
either.
-->
