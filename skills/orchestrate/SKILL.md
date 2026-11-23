---
name: orchestrate
description: Execute an orchestration doc — the full Codex loop, a checkpoint you must stop at, and a gate that refuses a PR the Codex pairing floor has not cleared (a plan the tree has since moved past, plus a current review of the diff). Use when the user points at a handover doc and wants it built. Phrases like "run this doc", "orchestrate this", "execute the handover", "build what's in that doc".
---

# Orchestrate — run a doc end to end

**Argument:** the absolute path to the orchestration doc — `/slopweaver:orchestrate /abs/path/to/doc.md`.
`$ARGUMENTS` holds it. With no argument, run `slopweaver handover list` and ask which doc is meant; never guess.

You have been handed an orchestration doc. This is how it gets built without the loop quietly collapsing into
"Claude did it alone", which is the failure this whole apparatus exists to prevent.

Read `/slopweaver:codex` first if you have not — it owns the verbs, the verdicts and the traps. This owns the
sequence.

---

## Before anything

1. **Verify the plugin.** Whatever the doc says to check, check it. A stale copy has cost hours repeatedly.

2. **Open the run through the door**, using the doc's `slug:` —
   `slopweaver handover start <slug> --branch <the-branch-you-will-work-on>`. This is not bookkeeping: it **refuses** a doc whose `doneWhen:` probes already
   pass with no `notDoneReason:` explaining the gap — the shipped-but-still-`ready` case, which otherwise
   costs a whole session re-planning finished work — and it refuses one the board blocks. It records the
   branch and the doc's content hash to a journal, which is what lets a later context rebuild this run after
   a compaction. If it refuses, read the refusal; it prints every probe and what to do.

3. **If the doc declares no `doneWhen:`, add them now, before building.** Two or four probes naming what the
   repository will look like when this has landed. A doc with no probes is one nothing can ever verify, and
   **a probe that cannot fail is worse than none — it manufactures confidence.** **If the doc's `summary:`
   records something the OWNER asked for, one of them must be BEHAVIOURAL** — a `command:` that RUNS the
   thing the owner complained about and exits non-zero if it comes back; `finish`, `lint` and `check` all refuse the
   `done` transition without one, and `probeWaiver: "<why>"` is the recorded escape when none can exist.

4. **Measure the baseline yourself.** Never quote a number the doc supplies; run the command.

5. **If a run was already open**, you are resuming, not starting: run `slopweaver handover resume <slug>`
   FIRST, before reading anything else, whenever a session begins or a compaction has happened. It rebuilds
   the doc, branch, probe state, any recorded question and the single next step from disk, not from memory.

6. **Reach the owner through a Queue card or a floating note, nothing else** — `handover ask` when a question
   only the owner can settle stops you, [hand](../hand/SKILL.md) for a step only the owner's hands can take.
   There is no sidebar checklist or status lane to keep: the owner reads neither.

Each step in full, with the probe shapes:
[reference/opening-a-run.md](reference/opening-a-run.md).

## The loop

1. **ONE plan pass** (the owner's bound). Point it at the doc's _unverified assumptions_ first, not its
   conclusions — _"what in this brief is unverified assertion rather than measured fact?"_ has repeatedly
   produced the value.
2. **In the same ask, the plan** built on that reading,
3. **and its pre-mortem:** _"this plan will be wrong about \___."_
4. **→ CHECKPOINT. Publish an artifact and STOP.** Do not start building.
5. **Build.** You write every line.
6. **Review, at most TWO passes** — one falsifiable property per call, against the diff; what still stands after
   the second lands only on `--acknowledge codex-loop-incomplete --reason` ([codex](../codex/SKILL.md) § The full loop).
7. **Land it** per `AGENTS.md` rule 1: undraft and enqueue once CI is green and the proof is as good as was feasible.

### The checkpoint is not optional

After the plan pass, publish a decision artifact in the owner's voice and wait. It must cover: what you are building and
what you are deliberately not; **which constraints the design bent around**, so the owner can say "that one is
not real"; what Codex pushed back on; what is still assumed rather than measured; and what proof would
convince the owner. Open questions get a stated lean, not a menu.

This exists because the owner does not read orchestration docs — the owner reacts to artifacts. The one time it ran, it
caught four wrong premises before a line was written. It is the highest-value step here.

### If the plan pass comes back BLOCKED on something only the owner can settle

Checkpoint immediately and say in the artifact that no plan stands yet. Planning past a blocker means
planning on a guess, which is what the checkpoint exists to prevent.

---

## While a pass runs

**Keep working.** A pass reads a frozen snapshot; your edits cannot reach it and it cannot reach you. Waiting
idle is a real cost — one measured session lost seventeen minutes to it.

Launch anything over ~500s in the **background**, never piped: the harness caps a foreground command at 600s
and a pipe swallows the heartbeat. Each pass prints a live log path on its first line — poll that on a backoff
and kill early if it has gone off course.

**Never sleep-poll a wait in the foreground, spending a turn per tick.** Measured: 51 minutes of `true` turns
on a PR, a `sleep 115; tail` loop for 1h17m. Every wait is one call on one contract (stepped backoff,
change-only output, `--timeout-seconds`, exit 4 on timeout): `slopweaver wait --pid|--file`, and `--wait` on
`github checks`, `turn review --poll`, `machine capacity`, `cmux spawn` and `github stack push` (that last
holds at the operation lock rather than refusing). Its OWN pull request's CI, rebase, red-CI fix and landing keep
the seat (`github checks --wait`, `--until merge` once queued; `handover park` refuses that wake). A clock or another
branch's pull request is a park, `handover park <slug> --wake-at <iso>|--wake-on-checks <owner/repo#n>`, and the
tick's `handover wake` reseats it once due. The poll gate (`docs/hooks/session-guards.md`) refuses a second read within 60s of a target that changed.

What you must **not** do is commit to a design decision the pass was launched to test, then rationalise its
findings away when they arrive. Nothing mechanical catches that.

---

## Before you call it done

```bash
yarn validate:pr
```

That is `yarn validate:local` plus `slopweaver codex status --check`, which, under the standing rule,
refuses unless this checkout's branch carries BOTH a conclusive **STALE `READY` plan** and a **CURRENT
conclusive review** (`AGENTS.md` rule 9). **The local lane, not the whole lap** — that lane
is the five gates CI cannot see the subject of, and mandating the full lap here would put every other
one back on the machine the ruling took them off ([toolchain/rebaseline-and-lanes.md](../../docs/toolchain/rebaseline-and-lanes.md#two-lanes-the-local-one-is-a-secrets-scan-and-a-working-tree-check-and-everything-else-is-cis) § Two lanes). Watch the
rest with `slopweaver github checks --number <n> --wait`. One plan and one review is the floor, two reviews
the ceiling; **a doc may raise the floor, never lower it**, which is why both live in the gate.

`SLOPWEAVER_ALLOW_UNREVIEWED=1` silences this LOCAL check and prints loudly; say so in the PR if you use it.
**It is not landing authority** — `github enqueue` and `github merge --admin` re-ask the same question at the
mutation and never read that variable. Trivial work gets past THOSE by acknowledging `codex-loop-incomplete`
with `--reason "…"`, which is written to the door ledger. **A capped or unregistered Codex stops nothing**: take
the passes yourself, visibly — the plan before any edit with `codex plan-fallback prepare` / `record`, the
review after with `codex review-fallback` ([reference](../codex/reference/claude-fallback-review.md)). Only work
begun with no plan rides that same acknowledgement, with a reason citing the file that holds the owner's words.

Then close the run:

```bash
slopweaver handover finish <slug>
```

It **re-evaluates every probe** and refuses while any still fails, printing the residue. That refusal is the
mechanism: the residue is either the rest of this doc's work, or it is a follow-up doc that now has to exist.
Do not force it through with `SLOPWEAVER_ALLOW_UNREVIEWED=1` just to see it pass.

It also refuses an owner-ask doc whose probes are ALL structural — see step 3. Write the behavioural probe
now, while you still remember what you proved, or record `probeWaiver:` saying why none can exist.

`finish` closes the RUN. It does not edit the doc's `status:`, and neither does anything else: a row's status
is DERIVED from its register (owner ruling: derive the state, delete the second copy). Once
the PR merges and the probes independently confirm it, the board moves the doc to `DONE` on the very next read
with no edit required; until then it prints `AWAITING SHIP` — finished, but not yet independently confirmed.

When the probes cannot confirm it — a doc with none, or one whose probes are narrower than its scope — record
the shipment rather than editing the file:

```bash
slopweaver handover close <slug> --summary "<what shipped>"
```

`close` needs no open run, so it is also the verb for a row that looks shipped and was never started, and it
writes nothing to the doc: [derived-row-state.md](../handover/reference/derived-row-state.md). A
`cancelled`/`rejected` call still requires the explicit edit, since nothing derives that a doc's work will
not be pursued.

---

## The three typed endings — a run must never just stop

Ending a run is a positive act. If the session dies mid-run instead, the `Stop` gate will say so on the next
turn and keep saying so until one of these is recorded:

```bash
slopweaver handover ask <slug> --question "<what only the owner can settle>"
slopweaver handover finish <slug>
slopweaver handover abandon <slug> --why "<reason>"
```

**A recorded question is success, not failure.** If you are blocked on a decision, write it down and stop — that
is the wanted artifact, and it is what stops this becoming a loop that wakes forever to report it cannot proceed.

If something needs the owner's live attention right now rather than a recorded question, reach the owner through the
supervisor: resolve its name with `ListAgents` and message it with `SendMessage`. Never `cmux send` into the
pinned supervisor workspace — that types into the box the owner talks into, not a message queue.

If the doc itself changed mid-run because planning found something, record that too, before continuing:

```bash
slopweaver handover amend <slug> --why "<what changed and why>"
```

An unrecorded amendment makes the doc's own probes lie, which is the defect this whole apparatus removes.

---

## Traps, each of which has cost real time

- **Branch on the `verdict` field, never the exit code.** `BROKEN` exits **0**.
- **A test may not invoke git directly** — use `gitInTemp` from `src/__tests__/tempGitRepo.ts`. A fixture
  line once created a branch and 35 commits in the real repository.
- **Verify a review's findings before acting.** They are often right and occasionally confidently wrong;
  reproduce the counterexample.
- **A green test is not a passing test.** Three times in one PR, a test was green because its fixture
  happened to satisfy it. Neuter the fix and confirm the test goes red.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
