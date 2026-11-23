#!/usr/bin/env bash
# The READ side of the protected-path guard: the third `PreToolUse` registration in `hooks/hooks.json`, for `Read`,
# `Grep`, `Glob` and `NotebookEdit`, the tools no other check covers.
#
# Those tools paid nothing before this row, and on a machine with no protected path they still pay nothing past
# this file: it starts no Node process unless a registry (`protected-paths.json`) sits in the configured state home
# or the account's default one — the two homes `src/admit/protectedPathGuardRunner.ts` reads. A registry is what
# the owner writes with `slopweaver protect add`, so a machine that never protected a path never boots a dispatcher
# for a read.
#
# When one exists it runs `./pretooluse.sh --only protected-path-guard`, so a read reaches that ONE row and no other
# check — the profile hold, the doors and the workflow tripwires never see a read. It FAILS OPEN at every ending it
# cannot decide (a spent budget, no runtime, an envelope kill): this row is a tripwire on reads, and a loaded machine
# refusing every `Read` would stop a session dead to protect against a read the guard could not judge. The
# registration carries `SLOPWEAVER_HOOK_GIVE_UP=0` for the envelope, and `SLOPWEAVER_PRETOOLUSE_READ_ROW=1` below
# tells `./pretooluse.sh`'s own `give_up` the same. `docs/security/protected-paths.md` names that residue.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../hooks/lib/profile-delivered.sh
source "$SELF_DIR/../hooks/lib/profile-delivered.sh"

# The configured home, as `./pretooluse.sh` resolves it: `$SLOPWEAVER_HOME`, else `~/.config/slopweaver/env`.
profile_home_export

REGISTRY="protected-paths.json"

# The account's OWN home, from the password database, as `accountDefaultHome()` (`src/homeDir.ts`) reads it — a seat
# can run with `$HOME` redirected, and a registry in the real default home must still start the guard. A login name
# outside the portable set is never expanded, and then this shim judges by running the guard rather than skipping it.
ACCOUNT_NAME="$(id -un 2>/dev/null || true)"
ACCOUNT_HOME=""
if [[ "$ACCOUNT_NAME" =~ ^[A-Za-z0-9._][A-Za-z0-9._-]*$ ]]; then
  eval "ACCOUNT_HOME=~$ACCOUNT_NAME"
fi

registry_absent() {
  [ ! -f "${SLOPWEAVER_HOME:-${HOME:-}/.slopweaver}/$REGISTRY" ] && [ ! -f "${HOME:-}/.slopweaver/$REGISTRY" ] &&
    [ -n "$ACCOUNT_HOME" ] && [ "$ACCOUNT_HOME" != "~$ACCOUNT_NAME" ] && [ ! -f "$ACCOUNT_HOME/.slopweaver/$REGISTRY" ]
}

if registry_absent; then
  exit 0
fi

# `./pretooluse.sh` runs under `set -u` and reads `$HOME`; an unset one would end it with 1, never a verdict. The account's
# own home stands in, so the guard runs.
if [ -z "${HOME:-}" ] && [ -n "$ACCOUNT_HOME" ]; then
  export HOME="$ACCOUNT_HOME"
fi

SLOPWEAVER_PRETOOLUSE_READ_ROW=1 exec "$SELF_DIR/pretooluse.sh" --only protected-path-guard
