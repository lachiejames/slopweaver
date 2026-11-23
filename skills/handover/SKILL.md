---
name: handover
description: Turn this conversation into an orchestration doc another chat can execute — or list the docs you already have. Use when work is bigger than the session, when the user wants to hand it off or pick it up later, or when they ask what work is outstanding. Phrases like "write this up as a handover", "what's on the board", "hand this off", "we'll pick this up later".
---

# Handover — move work between chats without losing anything

Two jobs, one door:

- **Author** — you have worked something out here and want a fresh chat to build it.
- **List** — you want to know which of your docs you can actually start right now.

They are one command because they are one problem. Every time you have asked for "a prompt to paste into
another chat", you were asking for an orchestration doc.

**One board, three kinds of row.** A planned doc, an ASK the owner made, and an unanswered Slack tag all sit on one ranking. `register` puts an ask on it the moment you hear one; `settle` ends it with a witness (and closes a run a DEAD session left open, or one parked with nobody holding it); `reconcile` says whether the fleet is on the top of that ranking, holding a row with no `repo:` until `set-repo <slug> --repo <checkout>` gives it one, and a finding whose cited file, verb or PR the trunk changed since until it is settled or `recheck <slug> --still-real "<check>"` ([top-band.md](reference/top-band.md)). WHOSE work a row is, the team's or this instance's own, by where the work ends up and never by what produced it, is stated as it lands with `register --workspace team|self --workspace-because "<why>"` (a verb that registers rows passes one when the row's own source says, and none otherwise; a row with none and no pull request or Slack destination is drawn on the `self` view only, marked placed by default: [one-board.md](reference/one-board.md)) or later with `set-workspace <slug> --workspace … --because "<why>"` (`set-workspace --respell` rewrites a row still spelling the old organisation-named word as its role, keeping the reason), never its `repo:`, which is only the checkout the seat ran in. `prune` says which rows still earn their keep: 111 of the 121 p0 rows one page offered as a queue were already settled on disk, so read the TRIMMED board before taking any list as work: [reading-the-board.md](reference/reading-the-board.md). The kinds, the terminal states, who may set each, and why an unplaced row never counts toward the top: [one-board.md](reference/one-board.md).

**An ask the owner has to PARSE is a defect**: a row waiting on the owner's word carries a `--problem`, two to four `--options` each with its trade-off, a `--lean`, its STAKES — `--risk`, `--blast-radius`, `--still-real` — and the `--example` scene the card leads with, freeform and never multiple choice ([ask-examples.md](reference/ask-examples.md)). Both recording verbs REFUSE one that does not, before anything is journalled. The two rows holding no decision of the owner's DECLARE it: `--finding` for a session's own observation, `--dispatch` for work a seat picks up (never beside `--finding` or a shape flag); a `--finding` given a shape waits on the owner's word like any ask. **An ask about a MESSAGE carries the message** (a draft written out that the owner can look at, in a Slack platform native view): `handover ask --action <json|path|->` and `handover offer` record the draft (a message in parts as `followUps`, each sent on its own), who it tags and one to three destinations, the console draws it Slack-native, and the OPTIONS are derived from the destinations — `--options` is REFUSED beside `--action` so a card can never print the owner's choice over a different message; a MAIL action is previewed at its own console URL and becomes a Gmail draft only on the owner's press: [ask-shape.md](reference/ask-shape.md).

**A recorded ask posts NOTHING to Slack**: it belongs on the console's Queue card, never in the owner's DM (the owner reads it in the localhost UI). It is a card only while the board calls it the owner's (`ownerWait`, `src/handover/ownerWait.ts`): a paused, terminal or since-ruled run is at most counted there, and one whose doc was archived, renamed or removed is swept back on by `list` ([detached asks](reference/reading-the-board.md#a-waiting-run-whose-doc-left-the-board)). A refresh pass that re-verifies a waiting ask records `handover reconfirm <slug> --still-real "<check>"` and never re-asks it, `handover correct` restates the check with the text (`--still-real`, required while the card prints one), and an ask whose premise resolved without the owner is taken back by its holder with `handover withdraw <slug> --why "<check>"`, never answered in the owner's name — a registered ask no run opened takes all three in its own front matter, no claim, a withdrawal `cancelled`: [ask-stakes.md](reference/ask-stakes.md). `ask`, `correct` and a decision `register` also REFUSE a question whose lead asks nothing or that names a pull request without its URL, and every ask verb refuses a picture named as a path — attach it boxed with `handover shot <slug> --shot <png> --box x,y,w,h=<label>`: [card-alignment.md](reference/card-alignment.md). A card naming a parked Slack draft by its `sd-` id draws it Slack-native on the card, and `ask`, `correct`, `offer`, `reconfirm`, a decision `register` and `hand post` REFUSE one naming a draft the register does not hold: [named-drafts.md](reference/named-drafts.md). On a row carrying the owner's words, `ask` lists every ready `talk-*` row registered after them and REFUSES until you have read each and name them all in `--read-owner-words <slug,...>`: one may already answer the question (`src/handover/laterOwnerWords.ts`). A seat putting a run's HELD question in front of the owner again — `hand post --row` naming it, `handover park` on it — is refused while the owner has spoken over its `ask:<slug>` card since it was asked, until each call anchor is named in the same `--read-owner-words` (`src/handover/ownerWordsBeforeReask.ts`): the owner's "I have saved it" over such a card was once re-asked twice.

```bash
slopweaver handover register --ask "<what the owner said>" --anchor <where the owner said it> \
  --problem "<one line>" --options "<a :: its cost>\n<b :: its cost [:: the owner's command]>" --lean "<what the owner would pick>" --risk "<…>" --blast-radius "<…>" --still-real "<how you confirmed it>"
slopweaver handover settle <slug> --as filed|answered|declined --witness <value> [--card done|recut|kept]
slopweaver handover close <slug> --summary "<what shipped>"
slopweaver handover artifact <slug> --url <where the answer was published>
slopweaver handover reconcile
slopweaver handover prune --priority p0
```

**A row's state is DERIVED — never hand-edit `status:`** (derive the state, delete the second copy). `close` records that the work shipped and writes NOTHING to the doc; it needs no open run, so it is also the verb for a row that looks shipped and was never started. `artifact` supersedes a published-answer pointer by append, and `rule` supersedes by decision time: [derived-row-state.md](reference/derived-row-state.md). `slopweaver sweep apply` is a CALLER of `close` and `settle` for exactly this reason, and their refusals stand: [sweep](../sweep/SKILL.md).

`handover rule <slug> --anchor <where> --words "<the owner's words>"` records what the owner DECIDED, as a journal event on any row kind — no document write, every reader derives it, and a later ruling wins by DECISION time; `handover audit-rulings [--manifest <path>]` accounts for every one read-only, and `handover backfill-rulings --manifest <path> [--apply]` records the ones the owner gave before the event kind existed. **The owner's EXPLICIT STEER** (said as overriding the previous guidance) is `handover rule <slug> --explicit-steer [--deliver-by <iso>] …`: it beats every standing rule for that row and the seat acts on it, and a seat that sees it slipping says so the minute it knows with `handover risk <slug> --why "<the uncertainty>"` (`--clear` once it passes), a note and a voice line at once ([steer-at-risk](../monitor/reference/steer-at-risk.md)). **A seat the owner keeps talking to** is `handover rule <slug> --standing-session [--standing-until <iso>] …`: close-done never parks it, `handover park` refuses it (hatch `SLOPWEAVER_ALLOW_PARK_STANDING_SESSION`), and the chair's reconcile reads it ready to reseat if it is found parked; an ordinary ruling leaves it standing, a later `--standing-until <now>` ends it ([parking-a-seat](reference/parking-a-seat.md)). On a row registered with `--finding --evidence <ref,...>` it is also what opens the team-facing GitHub doors, which REFUSE that branch until the owner's word is recorded; a pull request on THIS repository instead opens on the session's judgement and writes an autonomy-ledger row: [one-board.md](reference/one-board.md). Add `--gates "<noun> <verb>, …"` and a ruling REFUSES that verb at run time in every session, no hatch, lifted only by `handover gate release <id> --anchor <where> --words "<the owner's words>"` - so a DM-only ruling or a hold stops depending on the chair remembering it across a compaction: [ruling-gates.md](reference/ruling-gates.md). Words the owner SPEAKS to an open console card land on it (`talk transcript`) once the voice judged them its answer, never on a hand step; when those words also answer another card, close BOTH with `talk land --card <key> --words … --anchor … --decided …`, and put back one they pulled by mistake with `talk restore` (`docs/console/card-landing.md`). A row carries typed `key=value` tags from a closed key list — `handover tag <slug> workstream=<w> impact=high --why "<why>"`, or `register --tag` at birth — and a card or `list --tag key=value,key,!key` reads the tag, never the row's words: [row-tags.md](reference/row-tags.md). Its band is `handover set-priority <slug> --priority p0 --because "<why>"`, and `--backfill [--apply]` writes every unstated row its kind default, marked `priorityFrom: default` so it still ranks unplaced: [row-priority.md](reference/row-priority.md). **Settling a relay row spoken over an open hand card says what happens to the card**: `--card done`, `--card kept --card-why "<why>"` (answering was not finishing; the reason shows on the card) or `--card recut --card-new <id>`, and a bare settle is refused naming the card: [settle-card.md](reference/settle-card.md). **`--as answered` on a bare pull request URL reads its body live when the owner's words on the row ask for proof** (screenshots, run links, a Datadog view) and refuses naming what it lacks (`src/handover/proofAsk.ts`). **The owner's own words lead every expanded queue card**: a row anchored on `talk:`, `call:`, `talk-call:` or `transcript:` stores the owner's verbatim quote at `register`, `handover quote [<slug> ...] [--apply]` backfills and refreshes it (`--check` exits 1 while a row still needs a write, or a board file will not read), and a card whose anchor names the owner's words but carries none refuses; a hand `Write`/`Edit` rewording a `talk:` row's words is refused by `relay-words-guard`: [one-board.md](reference/one-board.md); `handover quote <slug> --add-steer <anchor> --apply` relates another steer of the owner's, drawn oldest first before why the card is in front of the owner ([bears-on.md](reference/bears-on.md)).

---

## Listing

```bash
slopweaver handover list           # non-terminal work only: runnable, in flight, waiting, contradictions
slopweaver handover list --all     # also shows DONE and CLOSED — NOT SHIPPED (cancelled/rejected)
slopweaver handover list --json    # for a CALLER: every row, closed sections included, `section` to filter on
```

Prints what is runnable now — the absolute path, the repo it targets, the artifact that explains it — then what is
waiting and on what. `done` and terminal-not-shipped docs (`cancelled`/`rejected`) are hidden by default and shown
with `--all`; a `CONTRADICTION` — a declared status disagreeing with the repository or its journal, a terminal doc
with a live run — is never hidden, since it is unresolved work regardless of authored status. Docs live in
`$SLOPWEAVER_HOME/handovers`, reachable from any repository; `--dir` points elsewhere. **It talks while it works, and a truncated board still PRINTS** when `--deadline` (60 s, `0` removes it) expires, because silence reads as an empty board: [why it was 474 s](reference/reading-the-board.md). **Never parse the rendered board** — `--json` projects the same `BoardModel`, so the two can differ on presentation and never on placement. **One row for a caller is `handover row --slug <slug> --json`**: the same row, summary whole, composed from that doc and its `blockedBy` closure alone (~0.8 s against the board's 7.8 s), plus `repoLargestPull` off its checkout's git so a bare PR number links with no board; as text it is one line, `--full` adding the doc's path. `register` likewise prints one receipt line plus any warning needing your hand, `--full` adding the path and the settle command. **Every steer the owner gave on a call, and whether it landed, is `handover steers [--json]`** ([steers](reference/reading-the-board.md#steers-the-boards-call-anchored-rows-joined-to-main)).

## Moving a live run between sessions

The board and journal are shared across Claude Code and Codex, but ownership never transfers by implication.
`handover resume <slug>` is read-only, so a destination session may inspect the run safely. The current writer
then yields it and the destination takes it:

```bash
slopweaver handover release <slug> --why "moving to the other visible host"
slopweaver handover claim <slug> --why "continuing in this visible session"
```

Every ordinary journal write refuses a foreign writer. A claim against a writer proven dead may proceed; a live
or unmeasurable writer requires `--force`, and that loud takeover is only for explicit owner-approved recovery.
Both transitions are append-only journal events, so the history survives compaction and session death.

---

## Authoring

You are writing a file into `$SLOPWEAVER_HOME/handovers/<slug>.md`. Start with the front-matter, because the
board is derived from it:

```yaml
---
slug: short-kebab-name
summary: what the work is; wrap it over indented lines if long — the board reads it whole
status: draft | ready | in-progress | paused (then `pausedOn:` is required) | done | cancelled | rejected
statusSummary: why the CURRENT status is credible — required going forward, see below
blockedBy: [other-slug]
repo: /absolute/path/to/the/repo/it/targets
artifact: file:///Users/…/.slopweaver/pages/<slug>/index.html
---
```

`role:` and `template:` are optional, and most docs omit both. `role:` colours the sidebar row, and only
`supervisor`, `bot` and `scheduler` take it (`src/cmux/role.ts`); a misspelt role is discarded, since a
colour must never make a doc unrunnable. `template:` (`code|research|supervisor|bot`) is the seat's launch
template: every one but `code` boots without the three code-standards rules. `cmux spawn --template` beats it,
and an absent one falls to the role's own; a misspelt template is a front-matter problem that `cmux spawn` refuses. `cmux templates`
prints what each loads.

`blocked` is **not** a status: it is derived from `blockedBy`, so declaring it too would be a second source of
truth. `paused` IS one and passes that test — nothing else carries WHO a row waits on, and a person is not a
slug. Write it with `handover pause <slug> --on <who>`, never by hand: it stays live under `PAUSED` with
nothing that can be overdue, and `start`/`cmux spawn` refuse it. [paused-rows](reference/paused-rows.md).

`cancelled` and `rejected` are terminal, like `done`, but not shipped: `cancelled` means the work will not be
pursued, `rejected` means it was explicitly not accepted. Both require `statusSummary:` to state why, and both
win over probe evidence — a `cancelled`/`rejected` doc whose probes later pass is a `CONTRADICTION` the board
surfaces, never silently reinterpreted as shipped.

`statusSummary:` is different from `summary:` — `summary:` is the stable "what is this work", `statusSummary:`
answers what an agent needs before acting on the doc's CURRENT state: confidence in that state, what is
blocked and on what, what human input remains, what can proceed independently, and (for a terminal status) why
the work stopped. It is required for every new doc and for any doc whose `status:` you change; an untouched doc without one
still passes.

`artifact:` matters more than it looks. Days later the owner reads the artifact, not the doc. A doc without
one is a doc that is harder to pick up, and the board says so out loud. **Never leave the key out entirely** —
`register-hygiene` reads the shared register in every session's pre-push hook, and a doc missing `artifact:`
blocks EVERY session's push until someone notices, not just yours. If there is genuinely no artifact yet,
declare `artifact: null` yourself; `slopweaver handover lint --doc <file> --fix` does this for you (see below).

### What the body must carry

Write for an agent with **no memory of this conversation**. That is the whole job, and everything below is a
consequence of it.

1. **How to launch**, and how to verify the right plugin is loaded. A stale copy has cost hours more than
   once. A ported standard needs its nearest owner ruling cited. `handover check`
   gates it.
2. **Absolute paths, and only to committed files.** A fresh chat cannot see your worktree or your untracked
   scratch file.
3. **Baselines as a command to run, never a number.** CI's `build` green via `slopweaver github checks --wait`, or
   a named test file passing — not "2,784 tests". Numbers go
   stale between writing and reading, and a stale baseline has already misled one session into thinking it
   had broken something.
4. **What is already decided, and then permission to attack it.** Supply the context so a pass is not
   rediscovering the corpus; never present a prior decision as settled truth. Both halves matter.
5. **Out of scope, each triaged to an owner.** "Report, do not fix" is only useful if the report has a home.
6. **The proof bar**, and what would falsify it.

### The behavioural probe — what `doneWhen:` must actually assert

`doneWhen:` is a list of observable consequences the repository can be asked about, re-evaluated on every
board read; a `done` doc whose probes regress lands in `CONTRADICTION` on its own.

**No doc may be set `done` without at least one probe that would FAIL if its claim were false** — asserted
against live state or a live command, never against the presence of a symbol, a heading, or a file. A bare
`grep`/`test -f`/`test -s` is not behavioural. `handover finish`, `lint` and `check` all apply it; `start`
WARNS as `open-run-declares-no-probe`. A `path:`/`present:`/`absent:` target must be REPO-RELATIVE — an
absolute one is a parse refusal with no waiver. The trigger is unconditional, so the mechanism owns the one
question needing no judgement — _does this carry anything that could fail?_ — while WHICH probe, or whether a
waiver is honest, stays yours. An `ask` row is exempt: a question makes no claim to falsify.

**It refuses by default, and the escape is recorded.** Fail loudly by default,
with an escape hatch — because proving that the owner will not raise this complaint twice is often genuinely
infeasible, and a loud default with a hatch makes an agent try harder without blocking a landing. The hatch
is `probeWaiver:` on the doc, written in your own words; every surface then PRINTS the waiver rather than
passing over the doc in silence, so an unsanctioned `done` stays visible on the board. Drop it the moment a
probe becomes writable.

Why a refusal and not advice: measured, five owner-ask docs marked `done` failed a live re-check
on the exact complaint, every one with green probes and three of them gold. **Before writing a new probe,
check whether the fix already has a real test proving the behaviour.**

The accepted and refused shapes, the trigger markers, the two break-glasses and three worked examples from
real docs are in [reference/behavioural-probes.md](reference/behavioural-probes.md).

### Before you hand it over, verify it

```bash
slopweaver handover check --doc <the file you just wrote> --repo <the repo it targets>
slopweaver handover lint --doc <the file you just wrote> --fix
```

`check` exits non-zero and names every finding: a referenced file that is not committed, a `--config` path a
`command:` probe names that does not exist on disk, a hard-coded count, a `blockedBy` slug no doc claims, an
unusable `status:`, a missing `artifact:`, an unstated launch audience, an uncited ported standard, and — for
`status: done` — the behavioural-probe rule above. `lint` applies that same rule across the whole board,
which is how a `done` set by HAND EDIT is caught: nothing writes that line — `handover close` records the
same fact where every reader derives it. Run `lint` after ANY hand-edit to front-matter, not only on writing.

**Run the verbs — do not hand-roll either check.** A hand-rolled check fails silently: a grep with a
hard-coded path prefix skips every reference that does not match and still reports every path verified. A
verification instruction with no mechanism produces a different incomplete check every time, and each one
reports success. If a referenced doc is genuinely missing, **stop and say so** rather than substituting
something similar. The four probe shapes that have read green while proving nothing, and what `lint --fix`
does and refuses to guess at, are in [reference/verifying-a-doc.md](reference/verifying-a-doc.md).

## The rule that makes this worth doing

A handover doc's job is not to prove the work was planned. It is to **aim the next agent**, including at the
things you are least sure about. A doc that hides its own uncertainty produces a confident pass over a bad
premise, which is the most expensive failure available.

## Running this from Codex

This skill runs on both hosts. In Codex, resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke `<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either host, because an ambient `PATH` may point at another checkout.

Driving a run once it is open — the lifecycle verbs, the three typed endings, the writer-transfer protocol, the only two ways a seat's state reaches the owner (a Queue card or a floating note), and when to hand a phase boundary to a fresh session rather than carry the transcript on — is in [reference/running-a-run.md](reference/running-a-run.md).

Run the bundled CLI's `doctor --json` before acting. Require its `pluginRoot` to equal this skill's plugin root and all `codexContinuitySkills` to be present. Hook-file presence does not prove Codex hook trust; `codex hooks` reads it, and `codex hooks --trust` writes it — the fleet's, never the owner's.

Use `$SLOPWEAVER_HOME/handovers` as the source of truth. For Codex sessions, set the artifact to `codex://thread/$CODEX_THREAD_ID` when that variable exists. Use absolute repository paths and committed probes, then run the bundled CLI's `handover check` against the target repository and `handover lint --fix` on the doc itself — a doc missing `artifact:` reddens `register-hygiene` in every session's pre-push hook, not just yours, so default it before handing the doc over.

For Slopweaver and any repository whose local authority marks work as personal, never create a Linear issue. The handover document is the tracker. Status follows reality: `in-progress` while implementation is live and `done` only after the requested landing and proof are complete. Moving a live run between hosts is [release and claim](#moving-a-live-run-between-sessions).
