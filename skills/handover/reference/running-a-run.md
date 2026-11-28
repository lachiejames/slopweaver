# Driving an open run

Bundled reference for the `handover` skill. Loaded when the body links here, not on every turn. The
instruction to resume an open run BEFORE anything else lives in `AGENTS.md`, because it decides what a session
does first; the verb catalogue here matters once a run is actually open.

## If an orchestration run is open, resume it before anything else

```bash
slopweaver handover list            # the board — what is runnable, what LOOKS SHIPPED, what is in flight
slopweaver handover resume <slug>   # rebuild an open run's brief from its journal, not from memory
```

If a run is open, run `resume` **first**. It reconstructs the doc, the branch, the probe state, any recorded
question and the single next step from `$SLOPWEAVER_HOME/runs/<slug>.jsonl` — a file, which survives both
compaction and session death. Re-deriving that from the conversation is how a run silently changes shape.

`resume` is read-only. If the journal names another visible session as writer, do not mutate it. An intentional
Claude Code ↔ Codex move is two typed journal events: the current writer runs
`slopweaver handover release <slug> --why "…"`, then the destination runs
`slopweaver handover claim <slug> --why "…"`. A live or unmeasurable takeover refuses unless the owner explicitly
authorises the loud `claim --force`; never infer that permission from the destination being able to read the doc.

**Each `doneWhen:` entry declares exactly one of `present`/`absent`/`path`/`command` — never two keys on the
same entry.** `name:` alongside `command:` is the common slip, and it is not tolerated as extra documentation:
`probe.ts`'s `parseEntry` rejects any entry with more than one key, and the doc reports the rejection rather
than silently dropping the entry. Measured: a doc with four such two-key entries parsed to zero
probes and zero failures, so `resume` read it as an ordinary no-probe doc and reported "every probe passes" —
`resume`, `finish` and `list` all refuse a doc with any unparseable `doneWhen:` entry, naming the bad
entry, rather than evaluating the empty set that survived parsing.

Three endings are typed, and reaching any of them is success:

```bash
slopweaver handover ask <slug> --question "…"      # blocked on the owner — a legitimate ending
slopweaver handover finish <slug>                  # refuses while a declared probe still fails, and refuses
                                                   #   any doc with no BEHAVIOURAL probe and no waiver
slopweaver handover abandon <slug> --why "…"       # give up, explicitly
```

**`settle` is not one of them.** It ends the ask ROW, so a session that lands its work, settles and stops leaves its
cycle open, and `session close-done` reaps only an ENDED journal. Settle the row, then `finish` the run, with `handover
answer` first for an unanswered question. A second `settle` names the `settlement:` field, never the run's `answered`
event. **`settle` closes only runs nobody can `finish`**: a DEAD holder's gets `orphaned`, a PARKED unclaimed one
`finished` (`abandoned` if declined). Any other holder keeps the NEXT
lines; SessionStart never offers `claim` on a settled row (`settleEnding.ts`). **A dead
session is not an answer, nor a re-start**: a question survives `orphaned` or a peer's `start`, so the next cycle opens WAITING on it. **A page deliverable reaches the owner's Queue before either closes it** ([page delivery](page-delivery.md)).

**A finished cycle is CLOSED, and `start`/`cmux spawn` both refuse to re-open one.** `finish` leaves
`status:` alone by design, not by omission: `done` means the work SHIPPED, a run closes before any pull
request merges, and a terminal status beside a journal already recording closure is a second source of one
fact — the reasoning [one-board](one-board.md) gives for a settled ask keeping `status: ready`. So the journal
is the authority, both doors ask it and name the instant the cycle closed, and `handover resume <slug>` reads
back what it did. MEASURED by joining every `runs/*.jsonl` with a `finished` event to its doc's
`status:` line: **78 finished docs still read `ready` or `in-progress`, six of them signed off**.

```bash
cd "$SLOPWEAVER_HOME" && grep -l '"kind":"finished"' runs/*.jsonl |
  while read -r f; do awk '/^status:/{print $2; exit}' "handovers/$(basename "$f" .jsonl).md"; done | sort | uniq -c
```

The stale line was not the cost. `start`'s own landed check fires only when every declared probe currently PASSES, and this class is work whose outcome was a measurement — its probe is waived, failing or absent — so nothing either door read said the run had closed; one run, finished AND signed off, was read as open by two sessions an hour apart days later and nearly re-landed. **Re-opening a finished cycle is still legitimate**, since run state derives from the LAST `started` precisely so a follow-up can exist: `SLOPWEAVER_ALLOW_RERUN=1` on the same command opens a second cycle and says in one line that it did. One variable per risk — it does not also override `SLOPWEAVER_ALLOW_UNREVIEWED`.

**A recorded question is not a failure.** Writing down what only the owner can settle is the wanted artifact,
and it is the escape from every gate in this feature. What is not acceptable is a run that simply stops. A waiting question that goes stale is never re-asked (`ask` refuses): `handover correct <slug> --question "…" --why "…" --still-real "…"` journals the true text and its re-run check, which `resume`, the board and the Queue card read from then on ([ask-stakes.md](ask-stakes.md)). A question whose premise resolved without the owner is never answered for the owner: its holder runs `handover withdraw <slug> --why "<check>"`, which reopens the run and writes no answer in the owner's name ([ask-stakes.md](ask-stakes.md)); a registered ask no run opened takes both verbs in its own file, with no holder ([registered-ask-queue.md](registered-ask-queue.md)). The one exception is a question recorded with no shape and no draft, which `ask` with the full shape REPLACES, keeping its asked instant ([ask-shape.md](ask-shape.md)). Neither verb posts anything: a run blocked on the owner belongs on the console's Queue page, never in the owner's DM (the owner reads it on the localhost UI).

**If something needs the owner's live attention beyond what a recorded `ask` covers, reach the owner through the
supervisor with `SendMessage`, addressed to the ROLE as it stands at send time.** Resolve it immediately before
each send: `slopweaver cmux list --json` shows exactly one `pinned: true` workspace titled
`/slopweaver:supervisor`, and the `ListAgents` row matching its `currentDirectory` is the address — never a name
a brief quoted (a correlation that picks a convention, never an authentication:
`.claude/rules/cross-session-messages.md`). Chairs rotate on their own cadence, handing off at the fifth
auto-compaction among other reasons ([supervisor](../../supervisor/SKILL.md) § 6a), so a correctly resolved chair can retire inside one report.
**`SendMessage` returning success is not delivery.** Measured: two sends to a retired name both
returned `"success": true` and never arrived. Measured again: a loop session reported twice to the chair
that was live when it resolved, a successor was born twelve minutes later, and it believed for four hours it
had reported. **Only a reply confirms delivery** — treat an unanswered report as UNCONFIRMED, re-resolve, and
send again. Never `cmux send` into the pinned supervisor workspace: that box is the one the owner types into, and text
landing there is indistinguishable from the owner's own.

**`finish` refuses ANY doc while no `doneWhen:` probe would fail if its claim were false.** Measured:
five owner-ask docs, all marked `done`, failed a live re-check on the very complaint they were written
for while every probe stayed green — because each probe asserted a symbol, a heading or a file rather than
the behaviour. The trigger is unconditional, since a keyword heuristic falls to edge
cases; what counts as behavioural is in the [handover
skill](../SKILL.md#the-behavioural-probe--what-donewhen-must-actually-assert). Write the probe at `finish` time.

**The escape is `probeWaiver:` on the doc, not an environment variable.** The standing ruling: fail
loudly by default, with an escape hatch — because proving that the owner will not raise this complaint twice is often infeasible,
and a hard refuse would block landings for no gain. Write why no probe can exist, and the gate stands down
while every surface keeps PRINTING the waiver, so the exception stays on the board rather than going silent.
`SLOPWEAVER_ALLOW_STRUCTURAL_PROBE=1` is the one-shot break-glass on `finish` alone and records nothing;
`SLOPWEAVER_BEHAVIOURAL_PROBE_MODE=advise` demotes the whole rule and is not the shipped default.

**A `--dry-run` on the write verb the doc fixed is usually the cheapest behavioural probe there is** — it runs
the real door, renders the exact payload, and exits 0 without sending, so a probe can grep its output for the
thing the owner complained about; three worked examples are in [the handover
skill](../SKILL.md#the-behavioural-probe--what-donewhen-must-actually-assert). Not every write verb has one —
`turn answer`'s send is threaded through gates too deeply to preview — so audit before reaching for
`probeWaiver:`. The board is the **only** register of what is in flight
([docs/workstreams.md](../../../docs/workstreams.md)): never write a status document, add a doc to the board.

## Ending a run: say whether it learned anything

`finish` and `settle` both REFUSE a started run that has not answered. Two answers, and they are equal:

```bash
slopweaver knowledge record --run <slug> --domain <slug> --claim "…" --verdict confirmed   --tier 2 --surface api --evidence "…" [--repro "…"]     # something was learned
slopweaver handover finish <slug> --lessons none          # nothing was — a recorded answer, not a bypass
```

**The gate asks whether there was a lesson; it never demands that there was one.** Do not invent a row to get
past it — a register of filler is worse than an empty one, and the honest `none` is what keeps the rest of it
worth reading. What actually qualifies (paid for, not re-derivable by a fresh read, able to be wrong later)
and the tier ladder are in [the knowledge skill](../../knowledge/SKILL.md).

Two properties. **A run never `start`ed is not asked** — a row settled as bookkeeping had no investigation to
learn from. And **each cycle answers for itself**, because a stale answer carried over is the amnesia this
closes. `SLOPWEAVER_ALLOW_NO_LESSONS=1` forces past it, journalled, so say so in the PR. **Both verbs carry a
SECOND closing gate on those same two properties**: a branch that raised a pull request nothing has read the
checks of is refused until `github checks --wait` runs once — [checks-read.md](../../github/reference/checks-read.md).

The reason for asking HERE rather than mining transcripts later: the best time to ask an agent whether there is a
lesson is right after it did something, because otherwise the lesson is lost, distorted over time, harder to
re-derive or eventually unreachable.

## A seat's state reaches the owner as a Queue card or a floating note, nothing else

**There is no sidebar checklist and no status lane to keep.** The sidebar checklist and status are retired
entirely, since producing them wastes tokens. A seat's state reaches the owner only as a Queue card (`handover ask` records one) or a floating note
([hand](../../hand/SKILL.md)). The row itself carries identity only — its title, its role colour and its
`workspace:N` ref pill, which `cmux spawn` and every lifecycle verb publish for you.

```bash
slopweaver handover park <slug> [--wake-on-checks <owner/repo#n>|--wake-at <iso>]  # the owner's steer, a clock, or ANOTHER branch's CI: close the seat (its own landing never parks); the tick's ONE `handover wake` reseats a wake (parking-a-seat.md); on a held question the owner has since spoken over its `ask:<slug>` card, name each call anchor in `--read-owner-words` first
slopweaver cmux title "<what this is now>" # a workspace nobody spawned, or one whose subject has moved
```

## At a phase boundary, hand over to a fresh session rather than carry the transcript on

**A 900k-token chat doing 100k-token work is a bill, not an asset.** A chat can sit 900k tokens deep
and still do work that needs far less, so over 80% of the tokens in it could be cruft by that point.

**A run is the one thing on this machine that makes respawning genuinely cheap.** Everything that survives is
already on disk — the doc, the journal, the branch, the probe state, the recorded question — and `handover
resume` rebuilds the brief from the journal, not the transcript. The transcript a session carries into its
next phase is not the state; it is the cost of having got here.

**The rule.** At a phase boundary — a checklist item ticked, with more than one still to go — read your own
depth and act on it:

```bash
slopweaver session depth            # your own row is the one marked `self`
```

Your row is marked `self` — matched on Claude Code's own session id, so it is exact even where three sessions
share one worktree. If it says `respawn-candidate` and more than one phase remains, hand over. If it does not,
keep going — this is a gauge, not a timer, and mid-phase is never the moment.

```bash
slopweaver handover amend <slug> --why "…what the next session needs that the doc does not yet say"
slopweaver handover release <slug> --why "respawning fresh at a phase boundary"
slopweaver cmux spawn <slug> --model <the tier this work needs>   # same slug reuses the worktree + its own deps
slopweaver cmux close <your own workspace>                        # ONLY after the spawn is verified up
```

**Spawn before you close, and verify the spawn came up** (`slopweaver cmux list --json`, not the confirmation
line alone). A session that closes first and then finds the respawn failed has stranded a branch nobody holds.

**A reused tree is the row's OWN or a free one.** When the tree a spawn would reopen is held by a DIFFERENT row's
unclosed run or parked seat — a row declaring another seat's branch, say — `cmux spawn` refuses and names the holding
row and the tree (`foreign-worktree-holder`, `src/cli/commands/cmux/spawnTreeGate.ts`), and `handover register
--branch` warns at registration. Register such a row with no branch key; it is seated in a tree of its own. The
signal is the SESSION, not the slug: a row started by the session already holding the tree is one occupant, and the
main checkout, shared by design, is never asked (`src/cmux/treeOccupancy.ts`).

**Two carve-outs, and only two.**

- **A session whose value IS its accumulated context is exempt, by judgement.** A live investigation holding a
  hypothesis it has spent forty turns narrowing does not survive an amend note; a build phase with a clear
  next step does. Nothing mechanical can tell these apart, which is why the gauge reports a candidate and
  never acts on one.
- **The standing session — the Slack loop — is in scope for the gauge but not for this procedure.** It is
  near-stateless by design (arm/pid, ask lifecycle and cursors all live on disk), so it is respawned through
  its own start verb, not by releasing a run. The standing ruling: it is closed and
  respawned on a gauge, not nursed.
