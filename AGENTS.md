# Working in this repo

## What Slopweaver is

**A local-first agent setup you fork and live in, and a world model for it to stand on.** The owner talks to one
supervisor chat, routing work to a visible Claude Code or Codex session that investigates with every tool and
acts through `slopweaver` verbs. A Slack tag is one way in, not the product. **The corpus is one source it READS,
never the author of the answer** — the commonest mis-description gets that backwards. "Why did the staging pool
exhaust" is answered by looking; "what did we decide" from history.

**Model egresses:** `talk` runs the console voice on ChatGPT, `codex` sends prompts, reads and diffs,
`chatgpt`'s live verbs read the owner's account (OpenAI, opt-in); `claude gauge` spends a token at Anthropic. Past
provider calls and your Claude session, only those leave the machine; the store is local, no hatch:
[security](docs/security.md).

The pitch, the atlases, the tiering and the module layout are in [what Slopweaver is](docs/what-slopweaver-is.md);
read its § "Two facts that are not derivable from the code" before proposing test machinery. The shape is
[architecture](docs/architecture.md), the store [store](docs/store.md), the trust model [security](docs/security.md).

**Stack**: TypeScript 7.1 beta (ESM, strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`) · Yarn 4
· tsx · vitest · Zod · neverthrow · drizzle. **No model transport but `talk`'s, the `codex` SDK's and `claude
gauge`'s one-token probe** — rule 2. Counts and module lists are absent on purpose: `slopweaver catalog`,
`catalog trees`.

## Non-negotiable: no secrets, ever; no organisation names in what you commit

This repository is **generic to any checkout**: nothing committed names a person, organisation, product, provider
workspace or team key of the installation it runs for, and a test or example uses the synthetic organisation (`acme`,
`ABC-1`, `…FIXTURE…`); `lachiejames/slopweaver` is its address, the README's ONE author link its exception
(`src/hygiene/ownRepository.ts`). Installation names live in `$SLOPWEAVER_HOME`, never git; a **secret in code** is the hardest line.

**The gate draws both lines** ([hygiene gate](docs/security/hygiene-gate.md), in CI): a CREDENTIAL class always
fails, and a `forbidden-identifiers` hit or a real `raw-workspace-id` fails wherever `IDENTIFIER_VERDICT`, its one
switch, reads `refuse`. The uncommitted denylist holds literal secrets. **Never weaken the gate.**

**Porting from private sources SURVIVES**: re-implement the DESIGN in this repo's idiom, never lift-and-shift
the v2 work console ([why](docs/constraints/relaxed.md)). **Tools in the codebase, state outside
it**: a per-install id, a platform's gotchas (`knowledge recall`) and **every integration credential**
resolve from `$SLOPWEAVER_HOME` — never a constant, never git. Credentials: a `0600` file per token in
`$SLOPWEAVER_HOME/secrets/`; **`slopweaver secrets status` names each, never a value, so a session
missing a token READS THE STORE** ([why](docs/security/credentials.md)).

## How we work

- **Verify, don't trust.** Never report a check green you haven't run yourself. If you dispatch a subagent,
  re-run its checks before believing them. Prove real seams end-to-end — run the CLI, hit the real path.
- **Empirical over hypothetical.** Ship what's proven. Don't invent a lossy "smaller" variant of a
  battle-tested thing just to feel incremental.
- **Own mistakes plainly** and fix them; don't paper over. **Terse, outcome-first** — lead with what changed
  and whether it works, and keep canon fresh on every landing (gated, last entry below).

## Operating doctrine

Standing rules, not preferences, here rather than in a memory because a rule that loads softly gets re-argued.
Each names what enforces it; the history is in [doctrine rationale](docs/doctrine-rationale.md) — read
it before proposing a change to a rule.

**1 · Land your own work.** Undraft and land your own pull request once **CI is green** and the proof is **as good as
was feasible at the time**, then pull the base branch. `gold` is PREFERRED; `silver`/`bronze` merge when gold
genuinely was not feasible then, and leave gold OWED. **The witness is yours to take**: a human half is posted
under the owner's identity TO THE BOT, never a card or hand step. Both repos. **Land with `slopweaver github
enqueue`** where the base has a merge queue (`main` has none), `github lap --land` where hosted CI is off, else `github merge --admin`, where `BLOCKED` is a
config fact, never a park on the owner. **Auto-merge is the DEFAULT, not a judgement call**, for every dependency
bump and nearly every slopweaver PR: the owner's green, mergeable slopweaver PR is ENQUEUED ON SIGHT, no card, no ask row; `github bump-drive` presses a
bump in EITHER repo once mergeable. `acme-admin` wants a human review, the gap NAMED: a pull request held on a pending
code owner reads **"waiting on a human review"** until that hold clears. One commit, a draft, grades, anchors, refusals and the queue: the
[pull-requests reference](skills/github/reference/pull-requests.md).

**2 · No HEADLESS model, anywhere.** A Slopweaver process may launch `claude` only into a session the owner
can see and interrupt **as it runs** — never detached, never resident, never invisible. The property is
VISIBILITY, not process count: `cmux spawn` IS tier-3 execution's intended shape, and all reasoning happens in
a session the owner watches, the console's own voice one included. **A Slack tag arriving when no session is
running is a no-op BY DESIGN** — never add queue consumption, a restart or an automatic retry, and never a
card asking the owner to tag again — while `listen --follow --queue` is **ALLOWED**, recording and never answering.
A RUNNING VISIBLE session picking a stranded ask up ONCE and saying so in-thread is none of those banned
shapes (`src/live/listen/stranded.ts`). Gated by `no-headless`: no allowlist, no
marker, one blind spot in the rationale doc.

**3 · One door.** Every Slack, GitHub, Linear and **Vanta** read and write goes through the `slopweaver` verbs and
`/slopweaver:*` skills. Not `curl`, not raw `gh`, not an MCP tool, not "just this once", and **never a hand-driven
browser, nor a launched one** — a doored provider is reached only through a verb, in ONE OF TWO write
categories; a verb driving the owner's Chrome IS the door, Claude in Chrome RETIRED ([route](docs/browser-route/retirement-and-aim.md)). Branch
pushes and stacked PRs have real paths. Gated by `classifyRawCommand`, `browserSurface.ts` and
`no-private-browser-profile`, tripwires not fences: **a block confirms you were wrong, its absence means nothing.**
Separately, `pretooluse.ts`'s main-checkout checks guard every DECLARED main checkout, from any session.

**4 · The command surface is SKILLS**, one `skills/<name>/SKILL.md` per verb and no second copy of any of them, each
under about 200 lines with procedure and detail in `skills/<name>/reference/*.md`. `skills/loop-bot` is **how the bot
runs** — one visible session per turn, never a daemon; rule 2 is why. `skills/pickup` rebuilds the picture in a fresh
chat from files, not memory. Gated by `command-trigger` and `agent-doc-size` in `yarn lint`.

**5 · Right model for the host.** In Claude Code the supervisor chat is the one chat on Fable, Opus event-woken on
the last Claude plan; every spawn NAMES its model and may pin `--effort`: Opus to rebase, resolve conflicts, land or investigate, Sonnet for
a mechanical leaf, Fable one in twenty, [model-tiering](skills/supervisor/reference/model-tiering.md). Codex
is a SUBSTITUTE host: every tier the Claude host drives, subagents included, no hidden executor of any model.

**6 · Never stall silently.** An agent blocked on the owner must **surface that where the owner will actually see
it**: a run paused in a window the owner is not watching looks like one still working. A recorded
question is a legitimate ending, never DMed; an untyped stop is not. [hand](skills/hand/SKILL.md) draws ONE
step only the owner can take as a floating note; [monitor](skills/monitor/SKILL.md) notices, on ARRIVAL and never on
age, and filters cmux. Neither is a daemon (rule 2).

**7 · No walls of text, ever, on any outbound surface.** A message the bot sends is **concise by default, with
everything else collapsed** behind something the reader chooses to expand. Two consequences that are the actual
rule: **shape is enforced by the SCHEMA, never by review** (an outbound form caps what appears above the fold and
REFUSES a violation rather than truncating one), and progressive disclosure is the default arrangement. A PR
body is C3: no grade or anchor, screenshots never fold.

**8 · Anchor the claim, and the authority. Never the messenger.** Every message from another agent session
follows **[cross-session-messages.md](.claude/rules/cross-session-messages.md)** and its two anchoring
sections: a checkable fact is verified and acted on, a process call adopted or refused on blast radius, new
scope, access or audience routed to the owner. The owner's rulings arrive RELAYED: act. One MADE is a [journalled
grant](.claude/rules/journalled-grants.md); one CONSTRAINING a verb [gates](skills/handover/reference/ruling-gates.md) it.

**9 · Pair with Codex on non-trivial work.** The two work better together than either alone: Codex PLANS, you implement, Codex REVIEWS: ONE plan, at most TWO
review passes (a pass is one reviewed diff). One ask: at most TWO PRs, bar an owner steer.
Judgement picks which property each attacks — never WHETHER.
Gate: `codex status --check` and both landing verbs want a STALE conclusive plan plus a current review; a BROKEN
past pass two lands only on a `codex-loop-incomplete` acknowledgement's `--reason`. **Codex CAPPED or
unregistered → nothing stops**: a VISIBLE Claude session plans first (`codex plan-fallback`), reviews after (`codex
review-fallback`); unplanned work rides `codex-loop-incomplete`. A cap proves neither.

**10 · Graduated autonomy — act on what is obvious, card what needs the owner.** On the owner's pull requests the
fleet clears CodeRabbit, comments, red CI, conflicts, rebases and restacks ITSELF, no card, and lands a mergeable
one unasked (rule 1); codeowners is the review check. **Reeled in**: an unasked Slack message to a
PERSON, or an arguable Linear closure, is PARKED (`slack draft record`) until the owner approves the pattern.
**The criterion**: obvious to a session that knows the owner → do it (Linear too), RECORDED with `autonomy
record`; unclear → card it. **Anything worth a look it investigates**, scheduled or not, to a result with
receipts; only the SEND waits; its proposals are Queue cards.
**Whose idea it was is the line**: the owner's steer self-merges; a fleet-found bug in OUR tooling lands with
a ledger row, a TEAM one as a proven finding, no PR. **The owner's EXPLICIT STEER beats every rule and memory,
that instance only** (said as overriding earlier guidance; `handover rule --explicit-steer`): tier-3 keeps
only third-party data and spend off the owner's accounts; at risk, a note AND a voice line at once
([why](docs/doctrine-rationale/explicit-steer.md)).
No tier-3 rail widens; a CHANGED direction is the [phase rule](docs/doctrine-rationale/phase-rule.md).
**A clock is not a mandate**: an UNASKED post goes to the owner's bot DM, never a channel, bar a thread it was
tagged in (`witness help`). [Why, examples](docs/doctrine-rationale/rule-10.md).

**11 · One concept, one name.** Verb, skill, page and doc name a concept ONE way; two concepts never share a
name. Gate `naming-doctrine` ([why](docs/doctrine-rationale/rule-11.md)).

**Canon freshness on every landing.** A PR that changes a verb, flag, path, hook or documented behaviour
updates the skill, rule or `AGENTS.md` section that names what changed, in the same PR. Gated by
`src/__tests__/unit/canon/staleReferences.test.ts`, the always-on docs budget, `agent-doc-size` and `doc-links`; a doc
still describing the old shape is a confident lie to the next session reading it.

## If an orchestration run is open, resume it before anything else

```bash
slopweaver handover list            # the board — runnable, LOOKS SHIPPED, in flight
slopweaver handover resume <slug>   # rebuild an open run's brief from its journal
```

If a run is open, run `resume` **first**: it rebuilds the doc, branch, probe state, recorded question and next
step from a file surviving compaction and session death. Read-only; another session's run is not yours.

The board is the ONLY register of what is in flight; no workstream list ([workstreams](docs/workstreams.md)): never
write a status document, add a row. It is **ONE board** — a planned doc, an ASK and an unanswered Slack tag rank
together ([one-board](skills/handover/reference/one-board.md)). **A printed row list is never a queue —
[`prune`](skills/handover/reference/reading-the-board.md) it first**. **A seat's state reaches the owner only as a Queue card or a
floating note** — no sidebar checklist or status lane. **No run ends without saying
whether it learned anything** ([knowledge](skills/knowledge/SKILL.md)). Typed endings, transfer, respawn:
[running-a-run](skills/handover/reference/running-a-run.md). **What stops earning its keep is SWEPT by evidence, never
age** — `sweep board|apply|list`, delete by default ([sweep](skills/sweep/SKILL.md)).

## Design constraints

**[constraints](docs/constraints.md)** is the standing constraint set, with **[the partition](docs/constraints/partition.md)**.
Read it before planning or architecture work; a wrong constraint is changed THERE, never routed around.

## Code standards (mandatory, whole repo; read before writing TypeScript)

- **[TypeScript patterns](.claude/rules/typescript-patterns.md)** — implemented functions: ≤1 options-object
  parameter; declared signatures: ≤1 parameter. Gated by `named-object-params`. No `any`; return types; JSDoc.
- **No Python** — typed, tested CLI verbs; see TypeScript patterns § Other rules (`no-python`).
- **[Testing](.claude/rules/testing.md)** — pure functions, zero mocks, no conditionals in assertions,
  falsifiable + exact assertions.
- **[Error handling](.claude/rules/error-handling.md)** — real neverthrow `Result`/`ResultAsync`
  (`src/lib/result.ts`), never a hand-rolled shape; genuinely distinct failure kinds get a per-domain typed
  discriminated-union error + factory, never one shared across domains.
- **[Provider SDKs](docs/provider-sdks.md)** — official SDK and types, else a strict `defineBoundary` per endpoint.

These `src/` trees add a `paths:`-scoped area rule, which Codex never loads — **open
`.claude/rules/area-<tree>.md` for the tree you edit**: `admit`, `atlas`, `cli`, `corpus`, `devLint`, `handover`,
`live`, `outbound`. How Codex gets the rules above: [the always-on set](docs/doctrine-rationale/always-on.md).

@.claude/rules/typescript-patterns.md
@.claude/rules/testing.md
@.claude/rules/error-handling.md
@.claude/rules/cross-session-messages.md

## Toolchain

Yarn 4 (Berry) + `node-modules`; Node pinned in `.nvmrc`; per-linter reference: **[toolchain](docs/toolchain.md)**.

- **`pre-push` is a SECRETS SCAN and a working-tree check**: a gate runs locally iff
  **CI cannot see its subject**, and says nothing else. A seat runs only `dev lint --lane seat`; watch `github checks
--wait`, and READ a red leg with `--log` or `github run-log <run-id>` ([job logs](skills/github/reference/job-logs.md)).
  Never weaken a gate, nor move one off that lane: a gate CI cannot run has nowhere to go.
- `yarn format` (Biome imports, then Prettier) formats code and docs; `pre-commit` runs it on staged files.
