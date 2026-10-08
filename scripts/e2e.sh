#!/usr/bin/env bash
# Runs Playwright E2E against production builds of the API and web app, backed by the
# wishlist_e2e database in docker compose. Extra arguments are passed to `playwright test`.
set -euo pipefail

cd "$(dirname "$0")/.."

export API_ORIGIN="http://localhost:3101"
export E2E_DATABASE_URL="postgres://wishlist:wishlist@localhost:54329/wishlist_e2e"

docker compose up -d --wait
pnpm turbo run build --filter=@wishlist/api... --filter=@wishlist/web...
DATABASE_URL="$E2E_DATABASE_URL" pnpm --filter @wishlist/api db:migrate
pnpm --filter @wishlist/e2e test:e2e "$@"
