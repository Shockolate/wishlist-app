#!/usr/bin/env bash
# Manages `preview-seed`, the Neon branch every pr-* preview database is created from. It never
# holds production data (spec addendum 2026-10-08, §3.3).
#
# Usage:
#   scripts/preview-seed.sh ensure                       # prints id=<id>, created=<bool>, root=<bool>
#   scripts/preview-seed.sh check                        # exit 1 with a fix-it hint if it's missing
#   scripts/preview-seed.sh uri <branch-id>              # direct (unpooled) connection string
#   scripts/preview-seed.sh describe <name>              # name, id, parent_id and default flag
#   scripts/preview-seed.sh assert-child <child> <parent>
# Env: NEON_API_KEY, NEON_PROJECT_ID (the wishlist-preview project, D87) and
# NEON_PRODUCTION_PROJECT_ID (production's, which every subcommand refuses).
# Test seams: NEON_BRANCHES_FILE replaces the branch listing; DRY_RUN=1 prints the create request
# to stderr instead of sending it.
set -euo pipefail

seed_name="preview-seed"
api="https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID:-}"
auth=(-H "Authorization: Bearer ${NEON_API_KEY:-}" -H "Accept: application/json")

die() { echo "preview-seed: $*" >&2; exit 1; }

# D87: previews live in their own Neon project. Refuse production's, and refuse to run without knowing
# which project that is, so preview secrets pasted with production's ID can't send previews back in.
[[ -n "${NEON_PRODUCTION_PROJECT_ID:-}" ]] ||
  die "NEON_PRODUCTION_PROJECT_ID is unset, so the production project can't be refused (docs/deployment.md)"
[[ "${NEON_PROJECT_ID:-}" != "$NEON_PRODUCTION_PROJECT_ID" ]] ||
  die "refusing: NEON_PROJECT_ID is the production project; previews live in their own project (D87)"

list_branches() {
  if [[ -n "${NEON_BRANCHES_FILE:-}" ]]; then cat "$NEON_BRANCHES_FILE"; else curl -fsS "${auth[@]}" "$api/branches"; fi
}

field_by_name() { # <branches-json> <name> <field>
  jq -r --arg n "$2" --arg f "$3" '[.branches[] | select(.name == $n)][0][$f] // empty' <<<"$1"
}

wait_ready() {
  local id="$1" state=""
  for _ in $(seq 1 30); do
    state=$(curl -fsS "${auth[@]}" "$api/branches/$id" | jq -r '.branch.current_state // empty')
    [[ "$state" == "ready" ]] && return 0
    sleep 2
  done
  die "branch $id not ready after 60s (last state: ${state:-unknown})"
}

case "${1:-}" in
  ensure)
    branches=$(list_branches)
    main_id=$(jq -r '[.branches[] | select(.default == true)][0].id // empty' <<<"$branches")
    [[ -n "$main_id" ]] || die "no default branch found"
    seed_id=$(field_by_name "$branches" "$seed_name" id)
    created=false
    if [[ -z "$seed_id" ]]; then
      # An ordinary child of the preview project's default branch, which is empty: the project
      # holds no production data, so neither can the seed (D87). The workflow wipes and rebuilds it.
      body=$(jq -nc --arg n "$seed_name" --arg p "$main_id" \
        '{branch: {name: $n, parent_id: $p}, endpoints: [{type: "read_write"}]}')
      if [[ "${DRY_RUN:-}" == "1" ]]; then
        echo "would create: $body" >&2
        seed_id="dry-run"
        seed_parent="$main_id"
      else
        seed_id=$(curl -fsS -X POST "${auth[@]}" -H "Content-Type: application/json" -d "$body" "$api/branches" | jq -r '.branch.id')
        wait_ready "$seed_id"
        seed_parent=$(field_by_name "$(list_branches)" "$seed_name" parent_id)
      fi
      created=true
    else
      seed_parent=$(field_by_name "$branches" "$seed_name" parent_id)
    fi
    # Never hand the project's default branch to a job that wipes.
    [[ "$seed_id" != "$main_id" ]] || die "refusing: '$seed_name' resolved to the production branch ($main_id)"
    echo "id=$seed_id"
    echo "created=$created"
    # A seed with a parent may hold that parent's rows, so the workflow wipes it on every run. Since
    # D87 every seed has one, so every run wipes and rebuilds it from the migrations.
    if [[ -z "$seed_parent" ]]; then echo "root=true"; else echo "root=false"; fi
    ;;
  check)
    branches=$(list_branches)
    [[ -n "$(field_by_name "$branches" "$seed_name" id)" ]] ||
      die "the '$seed_name' branch does not exist. Run the 'Preview seed' workflow with reset=true first (docs/deployment.md)."
    echo "ok"
    ;;
  uri)
    id="${2:-}"
    [[ -n "$id" ]] || die "usage: uri <branch-id>"
    curl -fsS "${auth[@]}" "$api/connection_uri?branch_id=$id&database_name=neondb&role_name=neondb_owner&pooled=false" | jq -r '.uri'
    ;;
  describe)
    name="${2:-}"
    [[ -n "$name" ]] || die "usage: describe <name>"
    branches=$(list_branches)
    jq -r --arg n "$name" \
      '[.branches[] | select(.name == $n)][0] | "name=\(.name) id=\(.id) parent_id=\(.parent_id // "none") default=\(.default // false)"' \
      <<<"$branches"
    ;;
  assert-child)
    child="${2:-}" parent="${3:-}"
    [[ -n "$child" && -n "$parent" ]] || die "usage: assert-child <child> <parent>"
    branches=$(list_branches)
    parent_id=$(field_by_name "$branches" "$parent" id)
    [[ -n "$parent_id" ]] || die "no '$parent' branch"
    child_parent=$(field_by_name "$branches" "$child" parent_id)
    [[ "$child_parent" == "$parent_id" ]] ||
      die "'$child' does not descend from '$parent' (its parent is ${child_parent:-none}); it was probably cloned from production before previews switched to '$parent'. Delete it in Neon, or close and reopen the PR, then re-run."
    echo "$child descends from $parent ($parent_id)"
    ;;
  *) die "usage: preview-seed.sh ensure | check | uri <id> | describe <name> | assert-child <child> <parent>" ;;
esac
