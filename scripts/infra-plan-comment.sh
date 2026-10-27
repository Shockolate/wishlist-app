#!/usr/bin/env bash
# Prints the Markdown body of infra-plan.yml's sticky PR comment: a redacted `tofu show` of the
# plan, cut to 60,000 characters so the body stays under GitHub's 65,536-character limit.
# Usage: scripts/infra-plan-comment.sh <plan.txt> <head-sha>
set -euo pipefail

plan="${1:?usage: infra-plan-comment.sh <plan.txt> <head-sha>}"
sha="${2:?usage: infra-plan-comment.sh <plan.txt> <head-sha>}"
limit=60000

printf '**OpenTofu plan** for %s\n\n```\n' "$sha"
head -c "$limit" "$plan"
printf '\n```\n'
if (( $(wc -c < "$plan") > limit )); then
  printf '\nPlan truncated: run tofu plan locally for the rest.\n'
fi
