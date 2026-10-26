# tfreecode fork invariants

tfreecode is T3 Code (https://github.com/pingdotgg/t3code) with telemetry and T3 Connect
switched off, rebuilt from upstream's stable tags. This file is the contract for whoever
(human or agent) moves the fork onto a new upstream release. When upstream code moves,
re-establish these properties in the new code; do not force the old diff onto it.

## Rules for the patch

- Change as little as possible. Switch things off at their source (a default, a gate);
  never delete upstream modules, rename the product, or reformat upstream code.
- Every fork change in upstream files carries a `tfreecode:` comment, so
  `git grep -n "tfreecode:"` lists the whole patch.
- When upstream ships something that already guarantees an invariant (for example
  telemetry that defaults off outside official `pingdotgg/t3code` builds, or CLI
  downloads that follow the building repository), drop the matching fork patch instead
  of keeping both. The goal is a fork with no patches in upstream files.
- Fork-only files live in `FORK_INVARIANTS.md`, `scripts/fork/` and
  `.github/workflows/tfreecode-*.yml`. Upstream's own workflows stay untouched; they
  only run in `pingdotgg/t3code`.

## Invariants

1. **No product telemetry.** The server's PostHog analytics
   (`apps/server/src/telemetry/AnalyticsService.ts`) has no built-in key or host and is
   disabled unless `T3CODE_TELEMETRY_ENABLED=true` is set explicitly.
2. **No T3 Connect.** Builds carry no Clerk or relay configuration (never set
   `T3CODE_CLERK_*`, `T3CODE_RELAY_URL`, `VITE_*CLERK*`, `VITE_T3CODE_RELAY_URL` or relay
   tracing variables in tfreecode builds), so `hasCloudPublicConfig` is false on server
   and web. A T3 Connect link or managed tunnel stored in the T3 home by another build
   must not be revived at startup (`apps/server/src/server.ts`).
3. **Direct remote access keeps working.** Pairing over a port (`t3 serve`, `t3 pair`),
   SSH environments (`packages/ssh`, `apps/desktop/src/ssh`) and Tailscale are not
   touched by the fork.
4. **Everything installs and updates from tfreecode.** CLI updates, server self-update
   and the `t3` runtime that SSH environments install on remote hosts download from
   `dinooo13/tfreecode` releases (`packages/shared/src/cliRelease.ts`). The desktop
   updater follows `GITHUB_REPOSITORY` at build time, so tfreecode CI builds update from
   tfreecode releases.
5. **Nothing phones home.** `node scripts/fork/egress-check.mjs` passes: a running server
   tries no host outside its allowlist, and never `*.t3.codes`, PostHog, Clerk, Axiom or
   Cloudflare. `node scripts/fork/bundle-check.mjs` passes on built output.

## Operating the fork

- `main` mirrors upstream `main` untouched; `tfreecode` is the default branch.
- `tfreecode-sync` (daily) merges the newest upstream stable tag into a `sync/vX.Y.Z`
  branch and opens a PR whose body shows the fork delta and the `verify.sh` result. It
  opens a draft when the checks fail. Merging the PR triggers `tfreecode-release`.
- Upstream tags are fetched into `refs/upstream-tags/*`; this repository's `vX.Y.Z` tags
  are tfreecode releases and point at tfreecode commits.
- Secrets: `TFREECODE_SYNC_TOKEN` (fine-grained PAT for this repository with Contents,
  Pull requests and Workflows read/write, plus Actions read/write so it can keep
  upstream workflows disabled) and `ANTHROPIC_API_KEY`. Optional variable
  `TFREECODE_SYNC_MODEL` picks the Claude model (default `opus`).

## Out of scope

The mobile app (`apps/mobile`) and the marketing site are not built or shipped by
tfreecode, and their tests may still expect upstream values.
