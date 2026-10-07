# Spike A: stacked-PR merge method

- **Date:** 2026-10-07
- **Question:** Does `gh stack merge --squash` land a stack cleanly on `main` (spec §10, merge method)?
- **Setup:** two-layer stack (`docs/readme` → `docs/contributing`), PRs #1 and #2, created with `gh stack submit` (stack #3) and merged with `gh stack merge 2 --squash --yes`.

## Observed

- The first merge attempt failed: `✗ pull request #2 is a draft; mark it ready for review before merging`. Run non-interactively, `gh stack submit` creates new PRs **as drafts** unless `--open` is passed (`gh stack submit --help`). After `gh pr ready 1` and `gh pr ready 2`, the merge succeeded: `✓ Merged #1, #2 into main (abdbd83)`.
- PR states: #1 `MERGED` (e96b500); #2 `MERGED` (abdbd83). #2 still reports `baseRefName=docs/readme`, but its squash commit landed on `main`.
- `git log --oneline origin/main -4`:
  ```
  abdbd83 docs: add contributing guide for stacked PRs (#2)
  e96b500 docs: add README (#1)
  9282233 docs: add plan roadmap and plan 1 (walking skeleton); amend spec toolchain
  07de4ea docs: add wishlist app design spec
  ```
- Files per commit: `abdbd83` touches only `CONTRIBUTING.md` (+48); `e96b500` touches only `README.md` (+11).
- Both head branches were deleted from the remote (`delete-branch-on-merge`), and the stack merged without errors.

## Decision

- **Merge method:** squash.
- **Why:** each PR became exactly one commit on `main` containing only that PR's changes, titled with the PR title and number. That gives a linear history that reads one PR at a time.
- **Consequences:**
  - The ruleset's `allowed_merge_methods` is `["squash"]` (Task 13), and CONTRIBUTING documents it (Task 3).
  - Every later submit uses `gh stack submit --open`, so the PRs are ready for review rather than drafts.
