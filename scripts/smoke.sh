#!/usr/bin/env bash
# The quickstart, asserted. Run against whatever compose has just brought up,
# so the published image and a build of the working copy are held to one
# standard rather than two that drift.
#
#   scripts/smoke.sh [base-url]
set -euo pipefail
base="${1:-http://localhost:8900}"

test "$(curl -sf "$base/api/v1/ready" | jq -r .status)" = ready
test "$(curl -sf "$base/api/v1/auth/state" | jq -r .needs_setup)" = true

# The first run makes an owner, an organization, a project, and a key that an
# application can send with. Nothing else on this platform issues the first one.
key=$(curl -sf -X POST "$base/api/v1/setup" \
  -H 'content-type: application/json' \
  -H "origin: $base" \
  -d '{"email":"ci@example.com","password":"a long enough phrase",
       "organization":"CI","project":"Production"}' | jq -r .api_key)
test -n "$key"

curl -sf -X POST "$base/api/v1/ingest" \
  -H "authorization: Bearer $key" -H 'content-type: application/json' \
  -d '{"events":[{"board_id":"ci-1","kind":"run.opened"}]}' \
  | jq -e '.stored == 1' > /dev/null

# Reading is a separate door from writing: a key opens one and not the other.
code=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/v1/projects/proj_nothing/overview")
test "$code" = 401

# The interface, not just the API.
curl -sf "$base/" | grep -q '<div id="root">'

echo "smoke: the platform came up, took its first account, and stored an event"
