---
name: pickup
description: Resume the workstream of workstreams — one command that rebuilds the whole picture in a fresh chat, from files rather than from memory, never by asking the owner to re-explain what is already on disk. Use at the start of any session that continues this workstream, or when context has been lost to a compaction. Phrases like "pick up where we left off", "resume the meta workstream", "what were we doing", "bring me up to speed".
---

# Pick up the workstream of workstreams

You are resuming a body of work that spans several docs, every repository the organisation names plus this build's own, and a set of standing decisions. **All
of it is on disk.** Your job is to rebuild the picture by reading, not by asking the owner to re-explain it — the
owner has explained it several times already and considers that the core waste this whole effort exists to remove.

**Read nothing into this file that is not here.** It deliberately contains almost no facts, because a curated
summary is the thing that goes stale. It points; the targets are authoritative.

## 1. Establish the board — always first

```bash
slopweaver handover list
```

That is the **only** register of what is in flight. Read it before forming any plan. Then, for whichever doc the
owner names:

```bash
slopweaver handover resume <slug>
```

`resume` rebuilds a run's brief from its journal, which survives compaction and session death. Never reconstruct
a run from conversation.

**On a fresh pickup, read what the owner's open pull requests need** outright — the cadence gate is for the tick, and a
pickup wants the current picture:

```bash
slopweaver github landing --author @me
```

ONE act per pull request, nothing to infer, and a BOARD cell joining each to a handover row that DECLARES its branch: [landing.md](../github/reference/landing.md).

Then, in the same breath, ask whether the standing sessions are alive AND on current main:

```bash
slopweaver session standing --loop-session-key <today-s-loop-slug>   # exits 3 on anything needing action
```

It reports both trees each standing session runs on — its `bin` and its `plugin-dir`, which drift
independently — with a HEAD, a commits-behind count and a grade. **`stale` means it is running code or prose
the fleet has already replaced**, and for the loop the fix is `slopweaver session respawn loop`, which gates on
stale + quiet + a free successor run rather than trusting your timing. It also grades a **`supervisor`** half — freshness only, no liveness — over the declared
main checkout every session invoking the absolute path reads through and the pinned supervisor chat's own
plugin-dir; that one is cleared by `slopweaver checkout sync` or by reopening the chat, never by `respawn`.
It is in the boot block because the alternative was measured: the loop once ran a stale worktree
through a day of public failures, and every session read `live`.

## 2. The standing decisions — do not relitigate these

They are recorded as auto-memories and load themselves into every session. If one is missing from your context,
read it directly from the memory directory for this project. **Each was decided by the owner, with reasons; each
is attackable with new evidence, none by preference.**

- **No resident executors** is `AGENTS.md` rule 2: the bot runs only inside a visible session via
  `/slopweaver:loop` (a single turn is `/slopweaver:loop-bot`). **One loop at a time:** two sessions each running `slopweaver listen` means two Socket
  Mode connections and Slack load-balances tags between them, so a tag answered by neither reads as a dead bot.
  The startup line prints the count — anything above 1 is the bug. Killing the wrapper orphans the node child.
- **Model tiering** is `AGENTS.md` rule 5 and [model-tiering.md](../supervisor/reference/model-tiering.md); read
  it there rather than from a summary. Output tokens are the dearest item and the largest available lever.
- **No legacy** — rewrite in place so the current way reads as the way it was always intended. No `SUPERSEDED`
  files. The narrow exception is a correction stopping a false belief. Gated by `legacy-vocabulary`, on NAMES.
- **The layering** — this plugin is the generic template; a concrete implementation is built on top of it; a
  personal instance of that implementation is the owner's own. A connector is NOT owner-personal: Datadog, Vanta
  and the rest live in this plugin, and what differs per install — keys in `$SLOPWEAVER_HOME/secrets/`, a site or
  tenant in `profile.json` or the store — is resolved at run time, never a constant here.
- **GitHub polling is budgeted** at 20% of the measured rate limit, and **search is effectively banned** at
  30/hour. Re-measure with `gh api rate_limit` rather than trusting any number written down.
- **The corpus lane is live.** Every line here can go stale: check the owner's latest word
  before quoting one back at the owner.
- **Never build a background restart for a dead session.** Rule 2 allows `claude` only in a session the owner can see
  as it runs, and bars a restart or automatic retry for a Slack tag no session is there for; a seat that died is
  reseated visibly ([running-a-run](../handover/reference/running-a-run.md)), never revived out of sight.
- **Gold stays unspent** (the owner's ruling: avoid gold for as long as we can) — it is the only thing that
  costs money and the owner expects to re-derive bronze/silver again. A store read never needs it.
- **There is no retrieval programme.** RAG is dead: no pgvector, embeddings,
  re-ranking, semantic search or locally-built index. A question is answered by Postgres full text plus
  `--contains`/`--like` over the store, read by a fan-out of visible Haiku detectives. The chunk-then-rerank plan
  in `slopweaver-notes/programme/` §7.5 is dead — never revive or cite it.
- **Datadog, Vanta and every atlas live IN this plugin**, built so any install connects
  its own accounts: the tooling is here, each install brings its own keys (`slopweaver datadog verify` checks
  Datadog's) and keeps what it fetches in its own `$SLOPWEAVER_HOME`. Code here / data there is
  [atlas-intent](../../docs/atlas-intent/settled-decisions.md#where-the-code-lives-and-where-the-data-lives).

## 3. Where things live

```bash
ls "$SLOPWEAVER_HOME/handovers/"          # the docs — the executable units
ls "$SLOPWEAVER_HOME/runs/"               # run journals — append-only, the durable truth
ls "$SLOPWEAVER_HOME"/*.md                # prior research sweeps, NOT committed to any repo
```

That last directory is important and easy to miss: several completed research passes were written there rather
than into a repo — a design brief, an archive excavation, a context map, a knowledge audit. **Enumerate it before
commissioning any new investigation.** Re-running a sweep whose output already exists is the exact failure mode
the owner is trying to eliminate.

Repositories: this plugin's own checkout (private), and the work repo whose absolute path each doc names in its
own `repo:` field.

## 4. Verify before you trust — the two traps that have already bitten

- **A stale plugin has produced a false diagnosis.** The console has been observed serving from a long-lived
  sibling worktree rather than the reviewed build, which made correct, unit-tested code look broken. Run
  `yarn slopweaver doctor` to see which build is loaded before believing any behaviour you observe. The same
  trap has a second face on a standing session: its CLI and the skill prose it FOLLOWS come from two different
  paths and can be days apart — `session standing` reports both, and `doctor` sees only the one it runs in.
- **A probe can fail on its own documentation.** An `absent:` probe matched the very docstring that quoted the
  line it was checking for, so a finished doc read UNMET on the board for a day. Assert the REPLACEMENT in code,
  never the absence of a string that prose will legitimately keep saying. The LOOK SHIPPED column itself measures
  trustworthy (3/3) — it is the probe wording that lies, not the column.

## 5. How the owner wants to work

- **One chat per doc**, run in parallel where the docs are independent. The owner personally spins up a **new**
  chat; give the owner a single copy-paste block for that, never a menu of similar-looking commands. For a chat that is
  **already open**, drive it directly with `SendMessage` instead of relaying text through the owner — `ListAgents`
  lists every visible peer session by name, and messaging one resumes it with full context; copying and pasting
  back and forth is the failure it replaces. The reverse direction is refused, not just
  discouraged: `cmux send` into the pinned `/slopweaver:supervisor` workspace itself types into the box the
  owner talks into, so report to it (or receive from a spawned session that must) with `SendMessage`, never
  `cmux send`.
- **Surface design calls before building**, not after. The owner's stated fear is discovering that the owner
  regrets something only once it is built.
- **A recorded question is a legitimate ending.** `slopweaver handover ask <slug> --question "…"` beats guessing,
  and beats stopping silently.
- **A seat's state reaches the owner only as a Queue card or a floating note.** No sidebar checklist, no status
  lane (the owner's ruling): a question is a `handover ask`, a step only the owner's hands can take is a floating
  note.
- **Never sleep-poll in the foreground.** Measured: 51 minutes of `true` turns on a PR, a
  `sleep 115; tail` loop for 1h17m. A short wait inside active work is a bounded background job:
  `slopweaver wait --pid|--file`, or a verb's own `--wait`. Your OWN pull request's CI, rebase, red-CI fix and
  landing are the work and keep the seat: `github checks --wait`, `--until merge` once queued.
  Only a clock or another branch's pull request parks it: `handover park <slug> --wake-at <iso>|--wake-on-checks
<owner/repo#n>`, and `handover wake` reseats it. The poll gate (`docs/hooks/session-guards.md`) refuses a re-read within 60s of a target that changed.
- **Landing your own pull request** is `AGENTS.md` rule 1, read there rather than from a summary: grades, the
  gold anchor and the one-commit shape are in [pull-requests.md](../github/reference/pull-requests.md).

## 6. Then do this

State, in a few lines: which docs are runnable now, which are blocked and on what, which decisions are
outstanding, and the single next action you recommend. **Ask nothing you could have read.** If the board and the
files disagree with each other, say so — that disagreement is itself the most valuable thing you can report.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.

Start with the bundled CLI's `doctor --json`. Refuse to call the install proven unless all of these are exact:

- `pluginRoot` is this skill's plugin root;
- `version` is the loaded Codex manifest's cachebusted version;
- `codexContinuitySkills` says `handover`, `pickup`, and `orchestrate` are present;
- `statuses.pluginHooks` is `present`.

`statuses.pluginHookTrust` is deliberately `host-only-unverified`. Never turn the existence of `hooks/hooks.json`
into a claim that Codex trusted it. If startup/compaction/stop hook context has not appeared in this session, run
`slopweaver codex hooks --trust` yourself — trust is the fleet's, never the owner's — and start a fresh session before
relying on the gate.

1. Run `handover list`. It is the only register of current work.
2. If the owner names a slug, run `handover resume <slug>` before reading conversation history or re-planning.
   Resume is read-only and is safe even when another session owns the run.
3. Read the named doc, its repository authority files, and the journal-backed next step. Do not ask for facts
   already present there.
4. If this session owns the run, continue from the recorded next step.
5. If the run is unowned or explicitly released and the user asked to continue it here, run
   `handover claim <slug> --why "continuing in this Codex session"`.
6. If another writer is live or its liveness cannot be proved, do not force a takeover. Ask the owner to run
   `handover release <slug> --why "moving to Codex"` in that session, then claim here. Use `claim --force` only
   after the owner explicitly authorises taking the run away from the named writer; preserve the exact reason.

Report only the runnable docs, blockers, outstanding recorded decisions, and one recommended next action.

This is the Codex-native adapter. Work in the current visible Codex thread. Ignore Claude-specific model tiering
or slash-command wording in shared command documents. Codex is a substitute host with full driver parity
(AGENTS.md rule 5), so a subagent is available here exactly as it is on the Claude host — what is banned is
rule 2's shape, of any model: never a headless, detached or invisible runner, and never `slopweaver codex`
from inside this thread. Never silently mutate a foreign run. For personal repositories, use the handover as
the tracker; do not create Linear or use any ship-family workflow.
