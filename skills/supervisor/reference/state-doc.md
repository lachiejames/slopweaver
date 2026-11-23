# The state doc — a rolling window with an archive, held there by a refusal

A successor supervisor boots from a hand-maintained state doc outside this repo (SKILL.md § 4). This file is
the contract that doc runs under. The doc itself is the owner's own layer and this repo never names its path —
it is content, not shape ([the partition](../../../docs/constraints/partition.md)).

## What went wrong, measured

MEASURED over the last ELEVEN supervisors, from their own transcripts' `Read` offsets and `sed -n`
ranges (repro: pull every tool call naming the doc out of each session's transcript and union its line ranges):

- The doc stood at **3,444 lines / 163,383 words / 41 successor boot blocks**.
- The union of every line any of the eleven opened was **lines 3000–3444 — 12.9%**.
- **Lines 1–2999 were read by nobody**, in eleven handoffs.
- Five of the last six read fewer than 35 lines each. One never opened the file at all.
- 37 boot blocks carried the sentence "TRAPS (all earlier blocks still apply)" — a rule set that lives in
  blocks nobody reads, which is the forgetting mechanism written down in one line.

A doc whose read share falls as it grows is ballast with a memory on the end of it. So: **a rolling 24 hours
plus the current boot block, everything older archived untouched, and a refusal that keeps it that way.**

## The two caps

Both are ratcheted from that measurement, and both are checked by `slopweaver supervisor state-check --path
<doc>`, which `handover start` runs for any doc declaring `supervisorState:` in its front-matter.

| Cap                | Value         | Where the number comes from                                                                                                                     |
| ------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole doc          | **400 lines** | A rolling 24-hour window on the real doc measured 211 lines, so 400 is roughly 2x headroom for a busy day                                       |
| Current boot block | **60 lines**  | The 38 blocks measured min 9, median 32, p90 48, max 83 — 60 admits every one of the last twenty-two and refuses the three historical offenders |

Only the CURRENT block is judged. An archived block is text nobody boots from, and refusing a supervisor's
`handover start` over a predecessor's block would punish the wrong session for something the archive already
removes. The numbers live in `src/supervisor/stateDoc.ts` with their reproduction commands; ratchet them there,
never restate them in prose elsewhere.

## Editing it: three verbs, never a script

Nothing here is done in Python. A seat edits the doc through three verbs, whose
core is `src/supervisor/stateDocEdit.ts` and `stateDocFold.ts`, sharing `stateDocBlock.ts`:

- `slopweaver supervisor state-amend --doc <doc> --handoff <n> --row "<row>" …` puts rows into the seat's OWN
  block, before its `### RULINGS` line, or with `--after-rulings` at the end of the block under it.
- `slopweaver supervisor state-fold --doc <doc> --handoff <n> --keep <rows> --archive <name>.md --description
"<span>"` is the MID-SHIFT move once `state-amend` refuses at the block cap: every shift row above
  `### RULINGS` but the newest `--keep` goes verbatim to `archive/<name>.md`, and one
  `- FOLDED <n> row(s) …` note row naming that archive takes their place.
  Sub-headings and prose stay; the rulings and everything under them are never folded. An earlier fold's note
  row is a row like any other, so the next fold carries it into its archive and the chain stays walkable.
  Give every fold its own `--archive` name.
- `slopweaver supervisor state-archive --doc <doc> --predecessor <n> --successor <n> --archive <name>.md
--description "<shift>" --block-file <block> --successor-summary <path>` runs at boot: the predecessor's block goes verbatim to
  `archive/<name>.md`, a note naming its lines is chained straight after the predecessor's own
  `(archived by handoff-<n>). Nothing was deleted.` sentence, and the successor's block goes in at the tail. On a
  doc no seat has archived yet (a fresh install's), the note SEEDS the chain as the preamble's last paragraph; a
  preamble holding another seat's note but not the predecessor's is a broken chain and still refuses.

All three address a block headed `## handoff-<n> boot` that must be the doc's last `## ` section, and all three REFUSE
rather than truncate: over either cap (the same `>` semantics `state-check` uses, so an edit it accepts is never
one `state-check` would call over a cap), two consecutive blank lines, a doc that changed while the edit was
prepared, or an archive name already holding different bytes. An archive already holding the SAME bytes is
reused — that is the recovery when a run published the archive and failed before rewriting the doc: re-run it.

**A gap these verbs do not close, measured.** `parseStateDoc` still finds blocks by
`## SUCCESSOR BOOT BLOCK`, a heading the live doc has not used since its early chairs
(`grep -lE '^## handoff-[0-9]+ boot' ~/.slopweaver/handovers/archive/*`), so `state-check` and the
`handover start` refusal have judged only the whole-doc cap since — never the block cap, never the rulings
rows. Teaching it the live heading would refuse the next seat's `handover start` at once: the RULINGS rows of
handoffs 238-249 carry no URL (`awk '/^### RULINGS/{r=1;next} r&&/^- /&&!/https?:/' <archive file>`). That is a
change to the chain's boot gate, so it is the owner's call rather than this verb's.

## The current block lists the owner's rulings as ANCHORED ROWS, and the gate refuses prose

MEASURED: the block handed to one successor carried the owner's rulings as shift prose (that the stack gets no
review asks until its first pull request lands) and told the successor to run a scratchpad script hard-coding
dozens of pull-request numbers before every render. Nothing machine-readable said which rows the owner had ruled
on, so the next ranked list led with four of them, things the owner had already answered under the previous
supervisor. So the current boot block carries a `### RULINGS` section, and `state-check` refuses
a block without one (`rulings-missing`) or a row under it with no URL (`unanchored-ruling`):

```markdown
### RULINGS

- https://github.com/acme/acme-admin/pull/<number> — no review asks on the stack until its first PR lands (deferred)
- https://x.slack.com/archives/C0/p<digits> — post the discussion piece as written (approved)
- none <- the one row allowed when the owner ruled on nothing this shift
```

The row is for the successor's eye; the machine half of the same ruling is
`slopweaver session-start lock-in --item <url> --against <whenIso> …`, recorded the same tick, which is what
keeps the row off the next `session-start` list and the next `--open-prs` render
([session-start](../../session-start/SKILL.md) § standing).

## The successor summary is DERIVED, and `state-archive` verifies it

A boot block is shift MECHANICS, and measured over eleven handoffs it carries no statement of what the owner
wants to be TRUE — which is the gap the owner named. So the direction half of a handover is derived
rather than written: `slopweaver supervisor successor-summary --reconcile <json> --out <path>` renders the
outcomes the owner kept on the owner's Workstreams register with their anchors and this tick's coverage (or one line saying
the owner has kept none yet), then the whole ready set, and seals it with a
hash over its own body. `state-archive` REQUIRES `--successor-summary <path>` and refuses a file that is
not sealed or has been edited since. Why: [stated-outcomes.md](stated-outcomes.md).

## What a seat inherits from its predecessor's scratch — verbs, not scripts

**A seat's scratch is `$SLOPWEAVER_HOME/supervisor-scratch/<handoff>/`, never the harness scratchpad under
`/private/tmp`**, which a reboot wipes. MEASURED: one reboot took the briefing form, `run.json`
and the predecessor's copies with it, and the form had to be rebuilt from the published HTML
([reboot.md](reboot.md)). **Three files, carried once at boot with `slopweaver supervisor scratch-carry --from <predecessor> --to <yours>`**:
`form.json`, `open-pages.json`, `shell.txt`. Nothing else crosses. Take every reading fresh with `supervisor
tick-capture`; rebuild `run.json` and `autonomy-qualified.jsonl` with `supervisor refresh-run`; add a page's
entry to `open-pages.json` with `briefing card` ([open-page-cards.md](open-page-cards.md)). A successor doc
that says `rsync`, "copy tick.sh", "sed its number" or "python3 cards" is stale — write the verbs instead.

Why: a seat booted with `rsync -a` of the whole directory carries each predecessor's per-tick readings and
the scripts that took them — 35 GB across 182 seat directories, 686 MB in one, one script byte-identical
across nine seats (measured: `du -sh ~/.slopweaver/supervisor-scratch`).
If a successor genuinely needs another file, change `CARRIED_FILES` in `src/supervisor/scratch/carry.ts`.
Never hand-copy it.

**An `owner-turn-*.txt` you write goes to the store the same tick**: `slopweaver supervisor owner-turn-record
--file <path>` re-reads it and stores its exact bytes in `owner_turn`, so the owner's words outlive the scratch tier
(a loss audit found them in no backup). Read one back with `supervisor owner-turn-show --ref <anchor|turn>`,
which answers from the store only; `store import-fleet --only owner-turns` reconciles whatever a record missed.

## What a boot block may contain

Shift state only: what is in flight, the merge queue, standing orders for this shift, the ready queue, the
depth line, and where the successor picks up. **A standing rule does not go in a boot block** — it goes in a
file under `skills/supervisor/reference/`, where `agent-doc-size` and the canon stale-reference ratchet keep it
true. That is the whole point of the split: a rule in a boot block survives only if the next supervisor
remembers to copy it, and the measurement below is what that costs.

## Rules found DEAD — deleted, not carried

Measured by scanning eleven handoffs' TOOL RESULTS (what actually came back) rather than the prompt text the
sessions typed. Each of these was carried in the sweep prompt and **never once observed firing**:

- quote `===` in zsh — one real `zsh: = not found` in eleven handoffs
- backticks in CLI args get substituted — zero
- a `slopweaver`-prefixed `doneWhen` probe reads FALSE RED — zero; the supervisor registers no probes
- a probe shelling `bin/slopweaver` measures the plugin mirror — zero, same cause
- never bare `git stash` — zero; already canon in the harness's own worktree preamble
- `checkout sync` refuses untracked dirs — zero
- `reviewDecision` reads null on every PR in the other repo — carried for eight handoffs, never fired in one

And fourteen rules present in handoffs 30–32 were **absent from 36–38 while still true**, dropped by hand-copy
attrition with none re-instated. Both halves are the same defect, and the fix for both is that a standing rule
lives in [sweep-contract.md](sweep-contract.md) rather than in a paragraph someone retypes.
