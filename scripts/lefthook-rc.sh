# Sourced, never run: `lefthook.yml`'s `rc:` makes lefthook's generated hook shim (`.git/hooks/<hook>`) source this
# file before it looks for a lefthook runner. POSIX sh, because the shim is `#!/bin/sh`; no shebang, no `set -e`,
# because both would change the shell that sources it.
#
# Why: when no runner resolves, the shim prints "Can't find lefthook in PATH" and exits 0 — the status of that
# `echo` — having run no gate at all. `.git/hooks` is shared by every worktree, so a worktree with no
# `node_modules` hits it, and a plain `git push` or `slopweaver github stack submit` (which pushes through git,
# hook and all) then sends a commit no secrets scan has read. `slopweaver github push` already refuses on that
# printed line (`src/cli/commands/github/prePushGateRun.ts`); this closes every other route at the hook itself.
# Reproduce: `git worktree add <dir> origin/main` (no `yarn install`), commit a docs change there, `git push`.
#
# The criterion is the exact path the shim itself tests last among its `node_modules` candidates
# (`test -f "$dir/node_modules/lefthook/bin/index.js"`), so a checkout this file passes is one where the shim
# resolves a runner whatever else is on PATH or baked into it. And it is scoped to pre-push: that gate is
# `yarn validate:local`, which cannot run without this checkout's own `node_modules` whichever runner the shim
# finds. Every other hook is left alone: post-checkout fires on every `git worktree add`, before provisioning has
# installed anything, and lefthook's own `assert_lefthook_installed` would fail it there too.
# No override of its own: lefthook's `LEFTHOOK=0` (read above this line in the shim) and `--no-verify` remain.
if [ "${0##*/}" = "pre-push" ] && [ ! -f "$(git rev-parse --show-toplevel)/node_modules/lefthook/bin/index.js" ]; then
  echo "pre-push: $(git rev-parse --show-toplevel) has no node_modules/lefthook, so no pre-push gate can run and nothing was sent. Run yarn install in that checkout, then push again." >&2
  exit 1
fi
