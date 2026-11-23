#!/usr/bin/env bash
# COMPATIBILITY SHIM for the `main-checkout-dirty-guard` check. The guard that lived here is now one row in
# `src/admit/preToolUseChecks.ts`, run by `./pretooluse.sh`.
#
# This path survives because a seat reads `hooks.json` ONCE, at boot, and keeps resolving its command paths
# against the mirror for the rest of its life — so a seat that booted before the fold names all ten of these
# forever. MEASURED: a mirror sync from the folding branch removed the ten script paths
# `main`'s `hooks.json` still named, and seven seats lost every PreToolUse guard at once — failing
# NON-BLOCKING, so with no symptom on any of them. Each plugin root now keeps its OWN mirror, which
# narrows the blast radius and does not close it: the earlier unkeyed link is still last-boot-wins.
# `src/__tests__/subprocess/scripts/pluginMirrorHookCommands.test.ts` is what now fails if a sync drops one.
#
# `--only` and not the whole registry: ten shims each running all ten checks would have the second poll-gate
# pass refuse the call the first one just recorded. One shim, one check, same verdict it always gave.
#
# DELETE ALL TEN — and `PRE_FOLD_PRETOOLUSE_COMMANDS` in `src/__tests__/liveHookCommands.ts` with them, never
# one without the other — the moment no live seat can still be holding a pre-fold `hooks.json`. They are
# scaffolding for one migration, not a supported way to invoke a check.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pretooluse.sh" --only main-checkout-dirty-guard
