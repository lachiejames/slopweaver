# What a RUNNING session sees, and what it does not

Part of [An install stays current, or the feedback is about code that no longer exists](../install-stays-current.md).

This is the part that makes "current" ambiguous, so it is worth being exact. After a fast-forward or a
plugin update lands under a session that is already open:

| Surface                                           | Picked up live?                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A skill's `SKILL.md`, read when it is invoked     | **yes** — read from disk at use                                                                          |
| The `slopweaver` CLI and everything under `src/`  | **yes** — every invocation is a fresh process                                                            |
| A `PreToolUse` guard's logic                      | **yes** — runs from the installed plugin on every call, even under `--plugin-dir` ([hooks](../hooks.md)) |
| The list of registered commands, agents and hooks | **no** — resolved at session start; needs `/reload-plugins`                                              |
| An MCP server a plugin declares                   | **no** — needs `/reload-plugins`                                                                         |

So a session that was mid-turn when a merge landed will run the new CLI and read the new skill text, and
will still be offering the old command list. That is why auto-update deliberately waits and prompts rather
than swapping components underneath a live turn.

## A colleague can actually type `slopweaver`

The docs and skills say to run `slopweaver <verb>` (221 lines when counted). On the owner's machine the owner's
`~/.zshrc` defines a shell **function** named `slopweaver` that resolves to the current repo's
`bin/slopweaver`, else to the owner's own checkout; elsewhere nothing does — measured in a `HOME` without that
function, `command -v slopweaver` printed nothing.

`scripts/plugin-path-shim.sh` installs `~/.local/bin/slopweaver` pointing at the plugin's mirror, so the
command those lines name resolves. Fixing the class rather than the instances was the owner's
call — a mechanical sweep rewriting 221 prose lines is the shape that has already pushed false claims
through this repository.

It points at `…/plugins/data/slopweaver/mirror/current/bin/slopweaver` — the UNKEYED link, deliberately:
the hook surface is keyed per plugin root (`docs/hooks/mirrors-and-failure-policy.md` § One mirror per plugin root) while
a `slopweaver` binary is fleet policy and should be the installed one, whichever worktree booted last. Never
a versioned cache path,
because the mirror survives a version bump by construction and a cache path is pruned by one — which
happens on every commit. It never takes a name it does not own: a real file there is left alone, and so is a
symlink pointing anywhere outside the plugin's own data directory. If `~/.local/bin` is not on PATH it says
so **once**, and names the absolute path as the alternative. Held by
`src/__tests__/subprocess/scripts/pluginPathShim.test.ts`.

**`bin/slopweaver` walks the link chain by hand before computing its own directory.** `dirname` on an
unresolved `${BASH_SOURCE[0]}` is `~/.local/bin` itself through the shim, never the mirror, and `source
"$HERE/../hooks/lib/resolve-root.sh"` then dies with "No such file or directory" on every invocation — a
break the owner's own shell never shows, because the owner's function resolves `slopweaver` first. Held by
`src/__tests__/subprocess/scripts/binSlopweaverSymlink.test.ts`, which runs the shipped binary through a real
symlink.

The installer also refuses to write into `~/.local/bin` at all unless the mirror it was handed actually
lives under the real plugin data root (`PLUGIN_DATA`/`CLAUDE_PLUGIN_DATA`, or `$HOME/.claude/plugins/data/…`
by default) — a caller reproducing this against a throwaway mirror elsewhere, with an unmodified `$HOME`,
once re-pointed the **operator's own real link** at that throwaway location, because `BIN_DIR` was keyed on
`$HOME` alone. `BIN_DIR` can also be overridden directly, which is what a test exercising the write itself
should do rather than lean on the mirror-root check alone.

Skills already do this correctly — they call `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver"` and say outright never
to run a bare `slopweaver` — because a skill is read by an agent, which has that variable. Prose addressed
to a human does not, which is why the shim is the fix and not a rewrite.

**A command this CODE prints is on the human side of that line, and a gate draws it.** Measured:
`turn resume`'s worker-brief step 0a and `turn sweepCard`'s `card-stale:` remedy emitted that literal into a
command a WORKER pastes into its own shell; the variable is empty there, so the line ran `/bin/slopweaver`,
and because step 0a ends in `&` the shell backgrounded the failure and reported exit 0. Every emitted command
carries the resolved absolute path from `bundledLauncherPath` (`src/lib/pluginRoot.ts`), the one name for that
value. The `unexpanded-plugin-root` gate in `yarn lint` refuses the literal in any emitted
string, walking the AST so that prose like this paragraph is outside its criterion rather than exempted
from it.

## What is not solved

- **The auto-update half is unproven here** (above). It is the one link in the colleague's chain that this
  page takes on documentation rather than measurement, and it is named rather than buried for that reason.
- **Cache directories accumulate**, one per commit installed. Nothing in this repository prunes them.
- **A session already open stays on what it booted with** for commands, hooks and MCP servers. That is
  deliberate, not a gap, but it means "current" means "current as of the last launch" for those surfaces.
