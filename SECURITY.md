# Security policy

Hanker holds people's wishlists and who has claimed what, so a leaked share or manage link can spoil a surprise. I take reports seriously.

## Reporting a vulnerability

Please report it privately through [GitHub's private vulnerability reporting](https://github.com/Shockolate/wishlist-app/security/advisories/new). Don't open a public issue or pull request for it.

Include what you found, how to reproduce it, and what you think the impact is. A proof of concept against your own account is plenty.

This is a one-person project, so replies are best-effort. I aim to acknowledge a report within a few days and to say what I plan to do about it soon after.

## Scope

In scope: the code in this repository and the running site at https://hanker.dev, including its CI and deploy workflows.

Out of scope: weaknesses in the platforms it runs on (Vercel, Neon, Cloudflare, Sentry, Better Stack, Resend). Report those to the vendor.

Please don't read or change other people's data, run denial-of-service or volume tests, or send spam through the sign-up and email flows. Use accounts you created.

## Supported versions

Only the current `main` branch, which is what is deployed.

## What's already in place

[docs/operations.md](docs/operations.md) and the [design spec](docs/superpowers/specs/2026-10-07-wishlist-app-design.md) describe the controls: secret scanning with push protection, a CI trust model that keeps secrets out of build jobs, pinned dependencies and actions, and error reports that scrub share and manage tokens.
