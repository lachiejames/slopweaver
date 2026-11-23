# The always-on set

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

What every session pays for before it reads a line of code. Moved out of `AGENTS.md` § Code standards when
[rule 10](rule-10.md) was written, because the explanation cost more always-on bytes than the thing it explained.

Claude Code loads at launch: `AGENTS.md`, read natively because no CLAUDE.md wraps it
([portability](../agent-docs-practice.md#3--portability--one-agentsmd-no-claudemd)), everything it `@`-imports,
and every `.claude/rules/*.md` carrying no `paths:` frontmatter. **Codex reads `AGENTS.md` and nothing else**:
it expands no `@` import and never opens `.claude/rules/`, scoped or not. It gets the rest of the set from the
plugin instead — § How Codex receives the set, below.

**So the three code-standards rules carry no `paths:`.** `typescript-patterns.md`, `testing.md` and
`error-handling.md` are `@`-imported by `AGENTS.md`, which expands them at launch whatever their frontmatter
says, and `AGENTS.md` says to open them before writing code. A `paths:` on an imported rule buys nothing and
costs a second copy: Claude Code re-attaches a scoped rule as nested memory whenever a session reads a
matching file, import or no import, while an unscoped rule that is also imported loads once — the shape
`cross-session-messages.md` has always had. MEASURED over one week while the three were still scoped: each
re-attached about 446 times across the fleet's main transcripts, 36.6 MB of context every seat already held
(count the `"nested_memory"` attachment records by `attachment.path` across a week's transcripts under
`~/.claude/projects`). `docs/provider-sdks.md`, the fourth standard, is a plain link and
costs nothing at launch. `cross-session-messages.md` and `journalled-grants.md` govern every inbound message
and every relayed ruling rather than a file type, so there is no path that could scope them;
`journalled-grants.md` needs no import to load.

The set is measured and ratcheted by `src/canon/alwaysOnDocs.ts` (`UNSCOPED_RULES`, and the line and byte
budgets), asserted by `src/__tests__/unit/devGate/alwaysOnDocsBudget.test.ts` and re-measured at merge time by
`src/outbound/github/docsBudgetSweep.ts`.

**What that measurement covers: both hops.** `alwaysOnPaths` in `src/canon/alwaysOnDocs.ts` DISCOVERS the
set by walking `@` imports from the entry the host reads first (`alwaysOnEntry`: `AGENTS.md` here), and both
readers — the budget test and the merge-time sweep — call it, so the measured figure and the received one
are the same number. A literal list misses the second hop: MEASURED, the instruction files plus
`UNSCOPED_RULES` came to 422 lines and 31,848 bytes, while a Claude Code session actually receives
**995 lines and 72,109 bytes** — the budgets, a bigger subject rather than a relaxed ceiling, so a line added
to `typescript-patterns.md`, `testing.md` or `error-handling.md` is never free.
Re-measure with `wc -lc AGENTS.md .claude/rules/typescript-patterns.md .claude/rules/testing.md
.claude/rules/error-handling.md .claude/rules/cross-session-messages.md .claude/rules/journalled-grants.md`.

**Codex is the opposite case, and its cap is the one that is not ours to raise.** It reads `AGENTS.md` alone
and expands no import, so it receives 197 lines and 15,040 bytes — and it truncates that block mid-word at
`project_doc_max_bytes` (32,768) while saying nothing. That file carries its own budget against that cap,
which is the byte figure to watch; the set-wide byte ratchet is a ratchet. **So a new always-on paragraph is
still paid for by moving an existing one out to a linked doc** — which is exactly how rule 10 was added, and
why this section exists. `AGENTS.md`'s own headroom against the Codex cap is 17,728 bytes, measured with
`wc -c AGENTS.md` against that cap.

**A seat that never edits code does not load the code rules — launch templates.** A template per seat kind,
each loading only what that kind uses: DevSecOps rightsizing applied to sessions. `cmux spawn` resolves one of `code|research|supervisor|bot` (`--template`, then the doc's
`template:`, then the role's default; `src/cmux/launchTemplate.ts`), and every template but `code` adds
`--settings "{\"claudeMdExcludes\":[…]}"` naming the three code-standards rules by absolute path, spelled
`$PWD/…` so a long worktree path cannot push the typed line past the terminal's 1,024-byte `MAX_CANON`
(`src/cmux/ttyLineLimit.ts` refuses a line that would not fit) — Claude Code's
own setting, which drops an `@`-imported file and an unscoped rule alike, so the always-on set above stays
the one source and no second instructions file exists. MEASURED live on one build, two sonnet seats, `/context`:
`--template code` held 9 memory files at 30.2k tokens, `--template research` 6 files at 15.3k, the three
rules absent and `cross-session-messages.md`/`journalled-grants.md` present. Re-measure the file half with
`slopweaver cmux templates`. Codex expands no import, so a template changes nothing there and `cmux spawn
--driver codex --template …` is refused. Skill descriptions (64 skills, about 10k tokens in both seats) are
the next lever, `skillOverrides`, not yet taken.

## How Codex receives the set

The owner's ruling: the rules stay where they are, and a **Codex-only** plugin `SessionStart` hook injects them. The hook is
`hooks/codex-hooks.json`, listed beside the shared `hooks/hooks.json` in `.codex-plugin/plugin.json`'s
`"hooks"`; Claude Code reads `hooks/hooks.json` alone, so it never loads the set twice. Codex sets
`CLAUDE_PLUGIN_ROOT` too, so no hook can tell the hosts apart at run time — the separate file is the only
boundary, and `src/canon/hookManifests.ts` carries the measurement. The hook runs `slopweaver codex
rules-context`, which walks the same `alwaysOnPaths` the budget does, drops `AGENTS.md` (Codex already has
it), and prints the rest — about 57k characters — as `additionalContext`, silently in any other repository.

**`additionalContextLimit: 0` is load-bearing.** Past about 2,500 tokens Codex spills a hook's context to a
file under its temp dir and hands the model a head-and-tail preview. MEASURED in a sandboxed
`CODEX_HOME` whose turn got a 401, so no model ran: with the limit at 0 the rollout's developer message held
58,304 characters, the five rules whole; at the default it held a 10,546-character preview and a path.
`codex debug prompt-input` runs no hook, so it cannot show this; the rollout of a real first turn can.

**A hook Codex does not trust does not run, and says nothing.** Codex pins each hook's approval to its hash,
so a new hook or a changed one is skipped until it is trusted. **The fleet trusts them, never the owner** (the
owner never opens Codex directly, and a new hook needing the owner's hand again is what the owner does not want). `slopweaver codex hooks --trust` asks the app-server's
own config batch-write method to record each untrusted or modified Slopweaver hook's current hash under `hooks.state`,
scoped to `source: plugin` and the installed `slopweaver@<marketplace>` id, never `enabled`, so a hook the owner turned
off stays off; then it re-reads the hook list. Every `codex plugin-sync` refresh runs the same pass, so a
landing that changes a hook is trusted by the fleet that lands it. `slopweaver codex hooks` alone names any
still skipped. MEASURED on `~/.codex`: Codex was skipping all eleven shared hooks; on a later copy of it, one
`--trust` pass took 13 skipped to none.

The area rules are `paths:`-scoped, which Codex has no equivalent for, so they stay out of the hook;
`AGENTS.md` names each and tells a Codex session to open the one for the tree it edits.
