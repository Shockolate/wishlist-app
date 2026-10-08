# Contributing

## Workflow: stacked pull requests

Changes land as small PRs arranged in stacks with [`gh stack`](https://github.github.com/gh-stack/). Each layer is one reviewable concern and must pass CI on its own.

### One-time setup

```bash
gh extension install github/gh-stack
```

### Build a stack

```bash
git switch main && git pull --ff-only
gh stack init <first-branch>      # first layer, on top of main
# …commit…
gh stack add <next-branch>        # next layer, on top of the current one
# …commit…
gh stack submit --open            # push every layer and open/update one PR per layer, ready for review
```

### Address review feedback on a lower layer

```bash
gh stack checkout <pr-number>
# …commit the fix…
gh stack rebase --upstack         # replay the layers above onto the fix
gh stack push
```

### Stay current with main

```bash
gh stack sync
```

### Merge

Merging goes bottom-up. `gh stack merge <pr-number>` merges every layer up to and including that PR as a single all-or-nothing operation.

## Rules for every PR

- One reviewable concern per PR.
- Conventional Commit titles: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor:`.
- Behavior changes are written test-first.
- Never commit secrets. Only `.env.example` files, and the non-secret `apps/web/.env.development`, are tracked.

## Merge method

PRs are **squash-merged**: one commit on `main` per PR, titled with the PR's Conventional Commit title. The ruleset on `main` allows only this method. See [Spike A](docs/superpowers/spikes/2026-10-07-stacked-pr-merge.md) for how it was chosen.

Always submit with `--open`. Without it, a non-interactive `gh stack submit` creates draft PRs, and `gh stack merge` refuses to merge drafts.
