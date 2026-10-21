<!-- The PR title becomes the commit on main (squash merge). Use a Conventional Commit title: feat:, fix:, docs:, chore:, ci:, test:, refactor:. -->

## What and why

<!-- One reviewable concern. What changes, and what prompted it? -->

## How it was verified

<!-- Commands you ran and what they showed. Behavior changes are written test-first. -->

- [ ] `pnpm format:check`
- [ ] `pnpm turbo run lint typecheck test build`
- [ ] `pnpm test:integration` (if the API or schema changed)
- [ ] `pnpm test:e2e` (if a user-facing flow changed)

## Notes for the reviewer

<!-- Migrations (expand, then contract), anything hard to undo, or where you'd like a second opinion. -->
