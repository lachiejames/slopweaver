---
name: codex
description: Use Codex as a second brain — bounded planning and one-property diff review while Claude writes every line. Pairing is a STANDING rule (AGENTS.md rule 9) — use when a change is non-trivial, every one of them, so Codex plans first, Claude implements, and Codex reviews the diff. Use when a plan deserves a pre-mortem or second opinion too. Phrases like "plan this change", "review this diff", "run a codex pass", "get a second opinion", "pre-mortem this plan".
argument-hint: "[plan|review] [--pass p1..r3] ..."
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" codex $ARGUMENTS` and report the result.

The FLOOR below is enforced by the CLI (§ Pairing is STANDING); everything else here is judgement it cannot
express. Read both before your first invocation.

## The division of labour

**Codex is the brain. You are the body.** Codex plans and reviews; you write every line of code that ships.
It can read anything, run commands, reach the network and write inside its own per-pass scratch directory —
but **not into the repository**, because the repository is neither its workspace nor an additional writable
root. That one line is what keeps you both out of each other's way, and it is enforced by the type system and
two lint gates rather than by good intentions.

## Pairing is STANDING — the judgement is how much, never whether

**The owner's ruling: on every non-trivial change, Codex plans first, Claude implements, and Codex reviews
the resulting diff.** The owner's reason: Claude and Codex always work better together than either does
individually, so that needs to be something like a standing rule too. It is `AGENTS.md` rule 9, and
`codex status --check` and both landing verbs enforce it — see § The full loop.

Whether to pair is settled, and so is how much: **one plan, at most TWO review passes** (the owner's cap).
Judgement picks **which falsifiable property each attacks, and NEVER a codebase area**, because a heuristic for
picking areas falls to edge cases and builds a worse product. The tells, the counter-tell, and how many to run:
[reference/when-a-pass-earns-its-cost.md](reference/when-a-pass-earns-its-cost.md).

## Read the ARTIFACT, never the terminal

Every pass writes one immutable artifact under `$SLOPWEAVER_HOME/orchestration/<id>/artifact.md` and prints
its path in the stdout JSON. **Read that file.** Do not work from the terminal output, and never re-run a
pass because you think you missed some of its output — the artifact is complete by construction, written
once and atomically after the pass finished.

This is the fix for the failure that motivated the whole capability: answers getting truncated, or lost
with the process. If the path is printed, the file behind it is whole.

## Do NOT branch on the exit code

Codes 0/1/2/3 are all taken, and **a review that finds a real defect SUCCEEDED, so it exits 0.**

Branch on the `verdict` field in the stdout JSON:

| verdict               | what it means                       | what you do                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLEAN`               | the property held                   | proceed to the next property                                                                                                                                                                                                                                                                                                                                                |
| `BROKEN`              | a concrete counterexample was found | **fix it, then take the second review pass.** After the second, NAME it as a leftover (§ The full loop); a third pass is refused, and a fix after it stales both                                                                                                                                                                                                            |
| `READY`               | the plan pass found no blocker      | proceed                                                                                                                                                                                                                                                                                                                                                                     |
| `BLOCKED`             | the plan pass found blockers        | resolve them first; they are listed in the artifact                                                                                                                                                                                                                                                                                                                         |
| `NO_VERDICT:<reason>` | the pass ran but concluded nothing  | **not clean.** Narrow the question and retry                                                                                                                                                                                                                                                                                                                                |
| `FATAL`               | the transport failed                | a fault, not a finding. Read its `cause` line first — a spend cap fails a one-line task identically, so never narrow a diff against one. `[refusal: cyber-policy]` is OpenAI's filter: the review already retried once, so take `review-fallback --after-refusal` ([fallback](reference/claude-fallback-review.md)). Its salvage section still holds what the pass had done |

`NO_VERDICT` is the one that catches people out. It is not approval. It means nothing was established.

## Bound the question, not the thinking

Every bound is a required flag. There is no default anywhere, on purpose: only you know whether this is a
narrow review or a long planning pass, and a default you inherit silently is a habit rather than a bound.

**The model defaults to `gpt-5.6-sol`, effort is pinned `medium`** (`gpt-6-astra` spent an account in
under a day). `--model <id>` picks the right model for one pass, both arms; `codex burn` measures what each buys.

**What to do when a run does not converge is NOT the same for the two arms.**

- **A review that does not converge: narrow the property.** One falsifiable claim that cannot be settled
  inside the bound is nearly always more than one claim. Raising the bound buys a longer wander.
- **A plan that does not converge: match the bound to the BREADTH you asked for, before narrowing anything.**
  A planning pass has to investigate a repository AND write a whole artifact, so the bound is a function of
  how much ground the prompt covers. Read the artifact's salvage section first: dozens of commands with
  `no-conclusion-in-bound` means it needed more time; almost no commands means the prompt is the problem.

The measurements behind this, and what the one-line summary does and does not quote:
[reference/reading-a-pass.md](reference/reading-a-pass.md).

## One property per call — fan out rather than widen

A property must be **falsifiable by a concrete input**. "Review for data integrity" is not a property;
"no migration is destructive to existing rows" is.

Reviewing several properties means several calls. Use `--properties-file` with `--concurrency` and each
property gets its own bounded call, its own thread and its own artifact — one failing cannot erase the
others. Each property is admitted, THEN routed, when its own slot opens: a duplicate reads no fleet and builds no client, and a queued property spends whatever the fleet ranks first when it starts, never a route taken before the fan-out ([routing](../plans/reference/codex-routing.md)). On an account under the owner's usage limit each routed pass also holds one weekly point until it ends, so siblings never jointly cross it. A plan pass is admitted, then routed, the same way. Writing five properties into one string defeats the entire mechanism, and the tool cannot detect
that for you: a grammatically single sentence can still hide 25 checks. That honesty is yours to keep.

```json
{
  "schemaVersion": 1,
  "properties": [
    { "id": "prop-1", "statement": "An aborted turn's usage is recorded as not-measured, never zero." },
    { "id": "prop-2", "statement": "A review refuses an empty diff before making any model call." }
  ]
}
```

## The full loop

1. **ONE plan pass** — `p2`, asked for what exists to reuse, the plan, and how it will be wrong; `p1`/`p3` are profiles, never extra steps.
2. **You implement**, in a worktree, off the current base branch. Never on `main`.
3. **Review pass ONE** — one fan-out over the diff, one property per call; `r1`/`r2`/`r3` are profiles, and
   every property over one diff is one pass. Fix every `BROKEN`.
4. **Review pass TWO, the last** — over the fixed diff. `codex review` and `review-fallback prepare` refuse a third diff before any spend (`codex-review-pass-cap`); a rebase keeps the diff, so it is the same pass. A baseline-bump witness counts in its own two-diff lane, never as a third pass ([rebaseline and lanes](../../docs/toolchain/rebaseline-and-lanes.md)).
5. Land the tree the second pass read: a fix after it leaves no current review, so it rides `--acknowledge codex-loop-incomplete --reason` or a follow-up. `codex status --check` prints each `BROKEN` still standing past pass two; each stays a `codex-loop-incomplete` finding on both landing verbs, landed only with `--acknowledge codex-loop-incomplete --reason "<why>"`, the reason in the door ledger. No PR description carries a leftover. Open a **draft** PR. Where the WORDING cannot be satisfied, `codex supersede` retires that one pass: [superseding-a-wording.md](reference/superseding-a-wording.md).
6. Run `yarn validate:pr` before you call it done — the LOCAL lane plus `codex status --check`, which refuses
   unless the branch carries a conclusive **STALE `READY` plan** and a **CURRENT, conclusive review**, judged
   at the branch's tip COMMIT by the landing verbs' own reader: a review that read uncommitted bytes is STALE
   there, and `codex status` prints a `DIRTY:` line when its rows were judged against them. STALE is the requirement, not a tolerance: a plan reads the tree BEFORE the work, so a CURRENT
   one is a post-hoc plan and proves nothing about order. `github enqueue` and `github merge --admin` ask the
   same question at the mutation and refuse with a `codex-loop-incomplete` finding; naming that subject needs
   `--reason "…"`, which is written to the door ledger. `SLOPWEAVER_ALLOW_UNREVIEWED=1` silences the local
   check only — it is NOT landing authority and neither landing verb reads it. `codex status` alone reports — and prints a `CAPPED:` line, naming the cap in every refusal, off the whole registered FLEET (`src/codex/fleetCap.ts`), read LIVE from each store's own app-server before any cached record, on a branch with no passes at all, and an `ADVISORY:` line for capacity left on the table (a store to sign into — the owner's, and a top-of-queue card, `codex-plan-signed-out` — or a held free reset, which the chair's tick redeems with `codex reset --at-limit` once a plan reaches its pause bar); one account exhausted beside an open one is a routing decision, not a cap. Every destination is drawn down in one pool and pauses for new work at the register's `pauseAtPercent` (99% used by default, `plans set-thresholds`), a routing bar that is never a cap, though a fleet held at it is ground for both fallback verbs ([routing](../plans/reference/codex-routing.md)).
   **When Codex is CAPPED, or no Codex plan is registered, nothing stops**: you take the passes in this visible session — the
   plan BEFORE any edit (`codex plan-fallback prepare`, answer, `record`), the review after (`codex
review-fallback`). Only work already begun unplanned rides `codex-loop-incomplete`. A cap alone proves neither: [claude-fallback-review.md](reference/claude-fallback-review.md).
   Treat `NOT RUN` as "no evidence this ran" rather than proof it did not: a pass whose tree could not be
   captured is recorded without a branch and cannot be placed on one, and the summary then says
   `UNATTRIBUTED: N recorded pass(es) captured no branch`.

Pass P1/P2 artifacts forward by including their content in the next pass's `--task-file`. Each pass is a
fresh thread, so nothing is assumed to carry over.

## Keep working while a pass runs — it reads a frozen copy

You do **not** have to wait, and you should not. A pass reads a snapshot of the tree taken when it started:
tracked edits, staged changes and untracked files included, ignored files excluded. Your later edits cannot
reach it, and it cannot reach your working tree. The artifact says which it read.

It holds what git would check out, not your raw bytes: if the repository configures line-ending filters, the
copy has them applied. Reviewing canonical content is the right call, but do not read a verdict as a claim
about bytes on your disk. On one measured run, an agent waiting on a 21-minute sweep found a real defect in
ninety seconds.

## A verdict goes STALE, not wrong

Every pass records the tree it read. Once you edit, that verdict is still **true about the code it judged**
and no longer describes the code you have. Ask the tool rather than tracking it yourself:

```
slopweaver codex status
```

It lists every pass in the loop for the current branch **of THIS checkout**, marks each `CURRENT`, `STALE` or
`UNKNOWN`, and —
this is the part that matters — lists the passes with **no record on this branch at all**. A table of what happened cannot
show an absence, and an absence is what went wrong on the PR it was built after: a plan and every
review were skipped in silence and nobody noticed until after the merge.

Do not cite a `STALE` CLEAN over code you have since changed: it goes into your next pass, while one is left. A review row's tree is its
**DIFF's** tree, read once and shared by every property of the fan-out, so `CURRENT` means the diff it judged
still describes yours and no two properties can disagree (rationale doc § Rule 9).

**`codex status` is keyed by CHECKOUT as well as branch**: a pass from a DIFFERENT worktree reads `NOT RUN` here,
and an `OTHER CHECKOUTS:` line names where it is. **The LANDING floor is not**: both landing verbs fold every
checkout holding the PR's head commit with a pass or receipt on its branch, and a waiver prints each failure it
waives, every drifted BROKEN with no later CLEAN under its property named.

## Watch a long pass without waiting on it

Any pass over ~500 seconds must be launched in the **background** and never piped — a foreground command is
capped at 600s by the harness, and a pipe swallows the heartbeat (a pass once sat at zero bytes for 22 minutes
while working perfectly). Each pass prints a live log path as its first line: poll it on a backoff — 30s, 1m,
2m, 5m — and kill early if it has gone off course. Watch for the failure the tripwire cannot see: a pass
**succeeding every command** while drifting away from the question. The snapshot is `--repo`, else your cwd's
git toplevel, and only the FAILED count shows a pass reading nothing: [which tree](reference/reading-a-pass.md#which-tree-a-pass-reads-and-the-counter-that-says-it-read-nothing).

## What is refused before any spend

A review refuses — with no model call and no cost — an empty diff, one over your `--max-diff-bytes`, a
binary change, a submodule pointer, or an unmerged tree. These are refusals rather than truncations
deliberately: a verdict over _part_ of a diff reads identically to a verdict over all of it. A THIRD
reviewed diff on the branch is refused the same way, Codex or fallback, and so is one whose fold cannot be read (`codex-review-pass-cap`).

If a refusal is wrong for your case, change the scope or raise the cap explicitly. Never work around it.

## What this does not protect against

Stated plainly so you do not over-trust it:

- **Prompt injection is bounded, not impossible.** The diff is a packet marked UNTRUSTED with the property
  restated after it, and the response must echo the exact property id — so an answer to a different
  question is rejected. No prompt can prove an answer was uninfluenced by text inside the diff.
- **The sandbox bounds WRITES, not reads.** Codex can read files anywhere it has permission, well outside
  its workspace. What it cannot do is write into the repository — its workspace is a per-pass scratch
  directory and the repo is not an additional writable root.
- **A globally configured MCP server is still started** by Codex. Tool dispatch is blocked, but the server
  process runs. See `docs/security/codex-boundary.md`.
- **A pass cannot open a window.** An app it launches aborts with a crash alert in front of the owner: Electron runs as
  Node there (`src/codex/electronSurface.ts`); a browser or `open` is barred by the prompt alone.
- **Your prompts, repo reads and diffs go to OpenAI.** Read-only protects your filesystem; it does not keep
  data local.

## Running this from Codex

In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted. In Codex, take the plugin root two directories
above this `SKILL.md` and invoke `<plugin-root>/bin/slopweaver` by absolute path, never bare `slopweaver`.
That root is Codex's COPY, re-added from main's HEAD on every landing by `codex plugin-sync`, which then trusts
every Slopweaver hook; `codex hooks [--trust]` reads or trusts them, never the owner's ([getting started](../../docs/getting-started.md#codex)).
