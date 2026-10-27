#!/usr/bin/env bash
# Decides infra-drift.yml's result from the plan step's outcome and the redacted plan text, and
# writes the plan into the job summary inside a fence (so "# resource …" lines aren't headings).
# OpenTofu writes a plan file, and tofu show reads it, even when planning failed, so an error is
# told from drift by what the plan text says, not by whether it exists (final review I-1).
# Usage: scripts/infra-drift-result.sh <plan step outcome> <drift.txt> <summary file>
set -euo pipefail

outcome="${1:?usage: infra-drift-result.sh <outcome> <drift.txt> <summary>}"
plan="${2:?usage: infra-drift-result.sh <outcome> <drift.txt> <summary>}"
summary="${3:?usage: infra-drift-result.sh <outcome> <drift.txt> <summary>}"

if [[ -f "$plan" ]]; then
  { printf '~~~~~~\n'; cat "$plan"; printf '\n~~~~~~\n'; } >> "$summary"
fi

if [[ "$outcome" == success ]]; then
  echo "No drift: live infrastructure matches infra/ on main."
elif [[ -f "$plan" ]] && ! grep -qE 'Planning failed|encountered a problem' "$plan"; then
  echo "::error::infrastructure drift: live settings differ from infra/ on main. The plan is in this run's summary."
  exit 1
else
  echo "::error::drift check could not plan: see the Plan step's log. Often an expired, revoked or under-scoped plan token, or an R2 backup rule's postcondition."
  exit 1
fi
