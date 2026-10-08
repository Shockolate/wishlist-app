#!/usr/bin/env bash
# Deletes Neon branches named pr-<number> whose pull request is no longer open. A safety net for
# the per-PR cleanup job: Neon's free plan caps a project at 10 branches.
#
# Usage: scripts/neon-sweep.sh [--dry-run]
# Env:   NEON_API_KEY, NEON_PROJECT_ID, GH_TOKEN (for `gh pr list`)
# Test seams: NEON_BRANCHES_FILE (branches JSON from a file) and OPEN_PRS (space-separated open
# PR numbers) replace the Neon and GitHub calls.
set -euo pipefail

dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then dry_run=true; fi

api="https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID:-}/branches"
auth=(-H "Authorization: Bearer ${NEON_API_KEY:-}" -H "Accept: application/json")

if [[ -n "${NEON_BRANCHES_FILE:-}" ]]; then
  branches_json=$(cat "$NEON_BRANCHES_FILE")
else
  branches_json=$(curl -fsS "${auth[@]}" "$api")
fi

if [[ -n "${OPEN_PRS+x}" ]]; then
  open_prs=$(tr ' ' '\n' <<<"$OPEN_PRS")
else
  open_prs=$(gh pr list --state open --limit 500 --json number --jq '.[].number')
fi

jq -r '.branches[] | select(.name | test("^pr-[0-9]+$")) | "\(.id) \(.name)"' <<<"$branches_json" |
  while read -r id name; do
    number="${name#pr-}"
    if grep -qx "$number" <<<"$open_prs"; then
      echo "keep         $name (PR #$number is open)"
    elif $dry_run; then
      echo "would delete $name ($id)"
    else
      curl -fsS -X DELETE "${auth[@]}" "$api/$id" >/dev/null
      echo "deleted      $name ($id)"
    fi
  done
