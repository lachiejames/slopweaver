---
name: protect
description: Keep the owner's protected paths — directories or files on this machine no agent session may write (read-only) or may neither read nor write (no-access) — in the state home, never the repository, and say whether one access is refused. Use when the owner wants a path kept away from sessions, when a tool call was refused with "protected read-only" or "protected no-access", when someone asks which paths are protected and why, or when a path must be unprotected on the owner's own word. Phrases like "don't let sessions touch that folder", "make that repo read-only", "keep my private files away from the agents", "what paths are protected", "why was that read refused", "unprotect that path".
argument-hint: "add <path> --mode read-only|no-access --why <reason> | remove <path> | list [--json] | check <path> [--write]"
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" protect $ARGUMENTS` and report the result.

## What it protects, and where the list lives

**The path is named in the STATE home, never in the codebase.** `$SLOPWEAVER_HOME/protected-paths.json` holds the
list, and the repository holds only the mechanism: this verb, the `PreToolUse` guard, the `talk file` refusal and the
bronze writer, which refuses a refresh's dedup read and append under a protected path, and the corpus readers, which
ask the same judge and skip and name a protected path under the corpus (`corpus-hygiene` prints it `NOT CHECKED` and
passes), and the corpus rewriters (`compact`, `fathom share`, `subset`, the ChatGPT take-in, the member and structure
stores), which judge every path they will write before the first one and refuse whole. The readers and rewriters
still unjudged are listed in protected paths.
Never write a protected path into a commit, a test, a doc, a pull request or a board row — a rule against naming
something, committed while naming it, is the failure this design exists to avoid. A test uses a synthetic path and
injects an empty resolver (`src/__tests__/noProtection.ts`), so it never reads the owner's own list.

| mode        | a session may read it | a session may write it |
| ----------- | --------------------- | ---------------------- |
| `read-only` | yes                   | no                     |
| `no-access` | no                    | no                     |

A directory protects everything under it. A search (`Grep`, `Glob`) rooted ABOVE a `no-access` path is refused too,
since it would read into it: narrow the root. The registry file itself is held read-only to every tool — this verb is
its only writer.

## Adding is free; loosening is the owner's

`add` of a new path, and tightening `read-only` to `no-access`, need nobody's leave. `remove`, and `add --mode
read-only` over a `no-access` path, give sessions back access the owner took away, so both refuse unless
`SLOPWEAVER_ALLOW_PROTECT_REMOVE=1` is set — and the hatch is for the owner's own relayed word, nothing else.

## What a refusal means, and what it does not

A refusal names the path, its mode and the owner's reason. **Do not route around it** with another tool or an
interpreter: ask the supervisor, who carries it to the owner. `SLOPWEAVER_ALLOW_PROTECTED_PATH=1` lifts one call,
and only on the owner's own word relayed with its anchor.

**It is a tripwire, not a fence.** Every session runs as the owner's own macOS user. The guard covers `Read`,
`Edit`, `Write`, `NotebookEdit`, `Grep`, `Glob` and `Bash`, and `talk file`; what it cannot see — an interpreter, a
nested shell, Codex's own sandbox reads, a symlink made after the check — is listed in
[protected paths](../../docs/security/protected-paths.md). Its silence proves nothing.
