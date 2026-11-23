# What markdown docs look like here

Every agent-facing markdown file in this repository is **at most 200 lines**, every other tracked `.md` **at
most 300**, and extra context is linked rather than inlined. Those are the owner's standing rules, one for the
agent-facing set and one for the rest, and their reason is progressive disclosure everywhere, for token
efficiency and agent performance. This page is how it works, what enforces it, and the sources it is
reasoned from.

## The practice

**The tighter cap is what a host loads as INSTRUCTIONS without anyone asking**: `AGENTS.md`,
`.claude/rules/**`, and the whole of `skills/**` — a `SKILL.md` body and every `reference/` file it links,
because a reference is read cold by an agent that has already spent its budget on the body. Everything else
— `docs/**`, the readmes, a fixture — is opened on demand, and an agent that opens one still pays for every
line of it, so it carries the looser cap rather than none.

**The disclosure mechanism is a short parent and linked children**: `skills/<verb>/reference/<topic>.md`
under a skill body, `docs/<topic>/<child>.md` under a docs page that becomes the topic's index. The split is
not arbitrary: **the parent keeps the rule, the decision and the index; the child keeps the procedure and the
detail**, and each fact has ONE owner — an index that re-explains its children is the restatement the cap
exists to remove. What leaves a parent is never deleted — a parent under the cap that omits something a
reader needs, with no child carrying it, is a worse failure than the wall it replaced.

**`agent-doc-size` in `yarn lint` enforces the caps**, counting raw lines (`wc -l`, so a refusal is
verifiable with one shell command) with no allowlist and no exemption marker. It is the opposite call to
`file-size-ratchet`, which counts CODE lines because a dense header costs a reader nothing; markdown inverts
that argument exactly, since prose IS the payload and there is no line a cap can price at zero. See
`src/devLint/agentDocSize.ts` for the ratchet it also carries, used only while a descent is in progress.

**`doc-links` keeps what moved linked into one tree.** Meeting a cap means moving detail, and a move breaks
every inbound anchor while each file still reads perfectly. The gate refuses a local link in any tracked
`.md` — or a repo-rooted doc reference such as `docs/<page>.md#<heading>` in shipped source — naming no
tracked file or no heading or explicit `<a id>` in it, and refuses a `docs/` or skill `reference/` page that
no readme, instruction file, rule or skill body reaches by following links and `@`-imports (an image is not
navigation). The imports are the always-on measure's own reader's, `importedPathsOf`, so the two never disagree;
the links are read off each page as GitHub draws it — `micromark` with GFM and `parse5`, already shipped for the PR-body gate — and ids headings with
`github-slugger`, GitHub's own algorithm and the one new dependency. The trade, measured before it
was written: `remark-validate-links` misread `README.md`'s explicit anchors as broken (11 of its 22
findings), pulled 196 packages and cannot see a TypeScript comment; `markdown-link-check` is an HTTP
liveness checker, the wrong boundary for an offline lint lane; `lychee` is a Rust binary outside this
toolchain. None of the three checks reachability, the half that makes it a tree. `src/devLint/docLinks.ts`.

**Three consequences worth stating**, because each has been re-derived at least once:

- **No fix for a host's own byte cap.** Codex assembles `AGENTS.md` up to a fixed ceiling and truncates
  mid-word past it. The answer is the cap above, not a config key and not a truncation-aware splitter: a file
  under 200 lines never reaches the ceiling. `codex debug prompt-input` dumps the exact bytes Codex receives,
  with no API call, if you need to prove it.
- **`AGENTS.md` is the one instructions file, with no CLAUDE.md anywhere** — Claude Code reads it natively
  and Codex always has, so both hosts read one file rather than two that drift ([§ 3](#3--portability--one-agentsmd-no-claudemd)).
- **The three code rules carry no `paths:` and `AGENTS.md` `@`-imports them** beside
  `cross-session-messages.md`, so a Claude session pays for all four unless its launch shed them: a cmux
  seat booted from the `research`, `bot` or `supervisor` template passes the three code rules to
  `claudeMdExcludes` (`src/cmux/launchTemplate.ts`), and only the `code` template keeps them. [The always-on set](doctrine-rationale/always-on.md) carries the measurement — `alwaysOnPaths`
  discovers the set by walking those imports rather than trusting a literal list, so a line added to any of
  them stops being free. Only the area rules below are `paths:`-scoped.

## The directory axis

**Settled when the owner released the hold on it and said to do what the memo recommended.** The memo is `~/.slopweaver/teamready/per-directory-agent-docs-memo.md`; its subject was
whether a flat `src/` should get per-directory agent docs, and its worry was that splitting the root doc
across directories duplicates content and worsens agent performance.

**Three options were measured, and B was the recommendation.** A was a per-directory CLAUDE.md — the port,
corrected to the filename that actually works, at the cost of three gates widened before the first file
lands. B is a `paths:`-scoped `.claude/rules/area-<name>.md` per tree: the same lazy-load profile, the same
zero always-on cost, and ALREADY inside all three gates, because `staleReferences`, `doc-counts` and
`agent-doc-size` all reach `.claude/rules/` by prefix. C was to do nothing. B is what shipped, for
`src/cli/`, `src/live/`, `src/outbound/` and `src/handover/`, then for `src/atlas/`, `src/corpus/`, `src/devLint/`
and `src/admit/`, the largest trees `slopweaver catalog health` still ranked unruled.

**What each host reads below the root.** Claude Code loads a subdirectory's instructions file ON DEMAND
when it reads a file there — its `AGENTS.md`, natively, when that directory has no CLAUDE.md (S1); Codex
reads `AGENTS.md` only and never descends below cwd. So a nested `AGENTS.md` reaches Claude but not Codex,
while a scoped rule reaches Claude alone either way, and `slopweaver codex` passes read neither —
`client.ts` sets `workingDirectory` to a per-pass scratch directory that is deliberately not a git
repository, so a Codex pass reads no repository instruction file at all, root or nested.

**Two risks that are real, and neither is duplication.** The documented failure mode is CONTRADICTION, not
repetition: "if two rules contradict each other, Claude may pick one arbitrarily" (S1). And **compaction
drop-out** — the root file is re-injected after a compaction, a scoped rule is not, returning only when a
matching file is next read. Anything load-bearing therefore stays at the root, and that applies to B exactly
as it would have to A.

**The one decision this made rather than inherited:** an area rule is an AUTHORITY DOC. It is registered in
`AUTHORITY_DOCS` (`src/devLint/docCounts.ts`), so the `doc-counts` gate refuses an inventory claim in one the
same way it does in a root file — an area rule is read as instructions the moment a session touches its
tree, so a count in it rots identically.

**The booted-session proof.** A Claude Code session launched at the repository root, with
no area rule in its startup context, read `src/live/listen/stranded.ts` and was handed `area-live.md` in
full at that moment; it then read `src/outbound/github/mergeGuard.ts` and was handed `area-outbound.md`, and
neither read delivered any of the other three. Lazy delivery works, and it is per-tree. Taken again
for the second four, in a fresh visible session booted in the worktree that added them: nothing scoped in its
startup context, then `src/atlas/registry.ts`, `src/corpus/types.ts`, `src/devLint/gateGroups.ts` and
`src/admit/door.ts` each delivered exactly its own tree's rule, and only that one, on the read. A rule written
mid-session does not reach the session that wrote it, so the proof needs a session booted after the file
exists. Reproduce by launching at the root and reading one file under a scoped tree.

**What a command can check, and the one property no other gate sees.** Scoping is gated already — an area
rule that loses its `paths:` becomes unconditional and `alwaysOnDocsBudget.test.ts` refuses it against
`UNSCOPED_RULES` — while `doc-counts`, `staleReferences` and `agent-doc-size` all reach these files by list
or by the `.claude/rules/` prefix. None of them compares the glob against the tree the file's own heading
claims, so `area-cli.md` scoped to `src/live/**` is green everywhere while being handed to the wrong session
and withheld from the right one. `src/canon/areaRules.ts` closes that, asserted by
`src/__tests__/unit/canon/areaRules.test.ts`: some glob must cover the heading's tree, which leaves a
subsystem free to add a second one for verbs living elsewhere — `area-handover.md` adds
`src/cli/commands/handover/**` — and still catches a rule whose globs miss its own subject.

## What stays where it is

- `skills/` at the repository root — the plugin location on both hosts.
- `.claude/rules/` — the documented directory for modular topic rules. Codex reads none of it, so its
  unscoped rules reach Codex through a Codex-only plugin `SessionStart` hook instead of moving (an owner
  ruling; [the always-on set](doctrine-rationale/always-on.md#how-codex-receives-the-set)), and
  `AGENTS.md` names each `paths:`-scoped area rule for a Codex session to open by hand.
- `README.md` — human-facing, named in backticks rather than imported, so it costs zero always-on context;
  under the 300-line cap, a landing page linking into `docs/`.
- `docs/` — read on demand, the destination for what leaves an always-on file, and indexed by
  [docs/README.md](README.md); `doc-links` refuses a page no readme, rule or skill body reaches.

## Sources read

| #   | Page                                            | URL                                                                                  |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| S1  | Claude Code — How Claude remembers your project | `https://code.claude.com/docs/en/memory`                                             |
| S2  | Claude Code — Best practices                    | `https://code.claude.com/docs/en/best-practices`                                     |
| S3  | Claude Code — Extend Claude Code                | `https://code.claude.com/docs/en/features-overview`                                  |
| S4  | Claude Code — Extend Claude with skills         | `https://code.claude.com/docs/en/skills`                                             |
| S5  | Claude Code — Monorepo / large codebase setup   | `https://code.claude.com/docs/en/large-codebases`                                    |
| S6  | Anthropic blog — Steering Claude Code           | `https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more` |
| S7  | Skill authoring best practices                  | `https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices`   |
| S8  | AGENTS.md — the open convention                 | `https://agents.md/`                                                                 |
| S9  | Codex — Custom instructions with AGENTS.md      | `https://learn.chatgpt.com/docs/agent-configuration/agents-md`                       |
| S10 | Local measurement                               | `codex debug prompt-input`, codex-cli 0.145.0, this worktree                         |

`https://docs.claude.com/en/docs/claude-code/*` 301s to `https://code.claude.com/docs/en/*`, so a doc or
skill linking the old host is pointing at a redirect.

## 1 · Size and shape of the always-loaded file

**200 lines is the host's own written target.**

> "**Size**: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce
> adherence." — S1

> "**Rule of thumb:** Keep CLAUDE.md under 200 lines. If it's growing, move reference content to skills
> or split into `.claude/rules/` files." — S3

> "Keep CLAUDE.md under 200 lines, give it an owner, and review changes to it like code." — S6

> "Keep it concise. For each line, ask: _'Would removing this cause Claude to make mistakes?'_ If not,
> cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" — S2

The hard ceiling is far higher and is not the operative limit: "Claude Code loads a CLAUDE.md file of up
to 4 MiB in full and skips a larger file. Shorter files produce better adherence." (S1)

**Imports do not buy context back.** This is the single most commonly mis-held belief about progressive
disclosure, and both pages say it plainly:

> "You can also split content into imports for organization, though imported files still load and enter
> the context window at launch." — S1

> "Splitting into `@path` imports helps organization but doesn't reduce context, since imported files
> load at launch." — S1

So `AGENTS.md`'s four `@.claude/rules/*.md` lines are an _organisation_ win and a _zero_-token win.
Only two things actually reduce always-on cost: `paths:` frontmatter on a rule, and moving content into
a skill.

## 2 · Where each thing is discovered

| Artifact          | Claude Code                                                      | Codex                                          | Loads                                  |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------- |
| Root instructions | `AGENTS.md`, root → cwd, when no CLAUDE.md is on that path (S1)  | `AGENTS.md`, root → cwd (S9)                   | Every session                          |
| Rules             | `.claude/rules/*.md`, recursive, `paths:` optional (S1)          | **not read**; the plugin hook injects them     | Every session, or on path match        |
| Project skills    | `.claude/skills/<name>/SKILL.md` (S4)                            | `.agents/skills/`, plugin `skills` (S10)       | Name+description at start; body on use |
| Plugin skills     | `<plugin>/skills/<name>/SKILL.md`, namespaced `plugin:name` (S4) | `.codex-plugin/plugin.json` → `"skills"` (S10) | Same                                   |
| Commands          | `.claude/commands/*.md`, or `<plugin>/commands/*.md` (S4)        | **not read** (S10)                             | Same                                   |
| Subagents         | `.claude/agents/*.md` (S2)                                       | —                                              | Name+description at start              |
| Hooks             | `<repo>/.claude/settings.json`, or `<plugin>/hooks/` (S2)        | plugin `hooks`, once trusted (S10)             | Zero unless output returned            |

Two things follow that matter here:

- **`.agents/` holds Codex's skills, never instructions.** Codex discovers repository skills under
  `.agents/skills/`; nothing on either host reads instructions or rules from `.agents/`. Claude Code uses
  `.claude/`; the portable convention for instructions is the _filename_ `AGENTS.md`, not a directory.
- **Codex runs plugin hooks, and pins each one's trust to its hash** (S10, re-measured on
  codex-cli 0.157.1). A new or changed hook is skipped, silently, until trusted; every `codex plugin-sync`
  refresh writes that trust through Codex's own app-server, and `slopweaver codex hooks` names any still
  skipped. That is how the always-on rules reach Codex
  ([the always-on set](doctrine-rationale/always-on.md#how-codex-receives-the-set)).
- **Top-level `skills/` is correct — for a plugin.** S4 gives `<plugin>/skills/<skill-name>/SKILL.md`
  as the plugin location, and Codex reads the same tree via `.codex-plugin/plugin.json`'s `"skills"`
  key (S10, measured). Slopweaver is a plugin, so its `skills/` at the repo root is the one directory
  in this repo that is already in the right place on both hosts.

**Custom commands have merged into skills** (S4). In S4's words, a command file and a same-named skill
directory "both create `/deploy` and work the same way… Skills are recommended since they support
additional features." Commands are supported, not deprecated — but they are the older half of a merged
surface, and Codex does not read them at all.

## 3 · Portability — one AGENTS.md, no CLAUDE.md

Claude Code reads `AGENTS.md` itself from v2.1.277, so this repository carries no CLAUDE.md, root or
`site/`. S1, verbatim:

> "Claude Code can read AGENTS.md as your project instructions, so a repository already set up for other
> coding agents works without adding a CLAUDE.md, an import, or a setting."

It reads every `AGENTS.md` from cwd upward only while NO CLAUDE.md (bare or under `.claude/`) or
CLAUDE.local.md sits on that path — one there and Claude reads it instead (the default `claude-md-or-agents-md`;
the user-level file in the home directory and `.claude/rules/` do not count). Read that way, `@` imports still expand and
`claudeMdExcludes` still applies, which is why the launch templates are unchanged; `InstructionsLoaded` hooks
do not fire (this repository has none), and `site/`'s Next.js `next dev` does not re-create a CLAUDE.md while
`site/AGENTS.md` carries its managed block (`generate-agent-files.js`, `writeAgentFiles`). The always-on
measure resolves its entry the same way (`alwaysOnEntry`, `src/canon/alwaysOnDocs.ts`).

**MEASURED on Claude Code 2.1.284, two sonnet seats booted by `cmux spawn` in a worktree of this
tree with no CLAUDE.md** — nested under the main checkout, whose CLAUDE.md still existed. Each transcript
carries the host's own line `no CLAUDE.md found; AGENTS.md loaded: <worktree>/AGENTS.md`, one path only, so
nothing above the worktree root counts or loads. `--template code` held `AGENTS.md` plus all five rules;
`--template research` held `AGENTS.md`, `cross-session-messages.md` and `journalled-grants.md` alone.
Re-measure: search a seat's transcript under `~/.claude/projects` for `AGENTS.md loaded` and its
`"path"` fields.

AGENTS.md itself is a filename convention with no size rule and no import syntax (S8). Codex's reader
adds three constraints Claude Code does not have (S9, confirmed by S10):

|                 | Claude Code                                 | Codex                                               |
| --------------- | ------------------------------------------- | --------------------------------------------------- |
| Size cap        | 4 MiB, whole file (S1)                      | `project_doc_max_bytes`, **32 KiB default** (S9)    |
| Over the cap    | file skipped entirely (S1)                  | **truncated mid-file** (S10, measured)              |
| `@path` imports | expanded at launch (S1)                     | **not expanded** (S9/S10, measured)                 |
| Nesting         | ancestors at launch, subdirs on demand (S1) | root → cwd, one file per directory, later wins (S9) |

Both hosts do per-directory nesting, and both take the nearest file as most specific — so a nested
`AGENTS.md` is portable in both directions.

## 4 · Auto-memory conventions

Auto memory is a separate system from CLAUDE.md and is machine-local (S1):

- Location `~/.claude/projects/<project>/memory/`, derived from the git repository, so **all worktrees
  share one directory**.
- Four types only — `user`, `feedback`, `project`, `reference` — recorded as a `type:` frontmatter field.
- "The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start
  of every conversation. Content beyond that threshold is not loaded at session start." (S1)
- Topic files are **not** loaded at startup; Claude reads them on demand.
- "Claude skips anything it can derive from the codebase… It also skips anything your CLAUDE.md files
  already say." (S1)
- Claude Code stamps a `modified:` ISO timestamp on any memory file that already has frontmatter (v2.1.214+).

So this project's `MEMORY.md` is an index of one line per memory, well under the limit: everything past
line 200 would be silently absent from every session.

## 5 · What is known to hurt

Each of these is a direct quote, not a paraphrase:

- **A long root file loses the rules inside it.** "If Claude keeps doing something you don't want despite
  having a rule against it, the file is probably too long and the rule is getting lost." (S2)
- **The over-specified CLAUDE.md.** "If your CLAUDE.md is too long, Claude ignores half of it because
  important rules get lost in the noise. **Fix**: Ruthlessly prune. If Claude already does something
  correctly without the instruction, delete it or convert it to a hook." (S2)
- **Contradictions get resolved arbitrarily.** "if two rules contradict each other, Claude may pick one
  arbitrarily." (S1)
- **Instructions that should be hooks.** "An instruction like 'never edit `.env`' in CLAUDE.md or a skill
  is a request, not a guarantee. A `PreToolUse` hook that blocks the edit is enforcement. If a rule must
  hold every time, make it a hook rather than a prompt instruction." (S3) S6 names the same anti-pattern
  as _"'Every time X, always do Y' instructions: use hooks instead"_.
- **Procedures in the root file.** S6: _"30-line procedures in CLAUDE.md: move to `.claude/skills/<name>/`."_
- **Unscoped rules.** S6: _"Use `paths:` frontmatter to limit context consumption."_
- **Emphasis inflation.** "If Claude keeps skipping one instruction, add emphasis such as 'IMPORTANT' to
  that line alone. If you emphasize many lines, none of them stands out." (S2)
- **Overlapping skill descriptions.** "If descriptions are vague or overlap, Claude may load the wrong
  skill or miss one that would help." (S3)
- **Skill bodies are a recurring cost.** "Once a skill loads, its content stays in context across turns,
  so every line is a recurring token cost." (S4) Keep a SKILL.md body under 500 lines (S7).
