#!/usr/bin/env bash
# The tfreecode gate (FORK_INVARIANTS.md): patch markers present, the packages the patch
# touches typecheck and pass their tests, and the built app neither embeds nor contacts
# upstream's telemetry or T3 Connect. Run from the repo root after `vp i`.
set -euo pipefail

step() { printf '\n==> %s\n' "$*"; }

step "patch markers"
markers="$(git grep -n "tfreecode:" -- apps packages ':!**/*.test.ts' || true)"
printf '%s\n' "$markers"
for file in \
  apps/server/src/telemetry/AnalyticsService.ts \
  apps/server/src/server.ts \
  packages/shared/src/cliRelease.ts; do
  if ! grep -q "tfreecode:" "$file" 2>/dev/null; then
    echo "missing tfreecode patch marker in $file (moved upstream? re-apply the invariant)" >&2
    exit 1
  fi
done

step "typecheck"
vp run --filter t3 --filter @t3tools/shared typecheck

step "focused tests"
(cd apps/server && vp test run src/telemetry/AnalyticsService.test.ts src/cli/update.test.ts)

step "build"
vp run build:desktop

step "bundle check"
node scripts/fork/bundle-check.mjs

step "egress check"
node scripts/fork/egress-check.mjs apps/server/dist/bin.mjs

printf '\ntfreecode verify passed\n'
