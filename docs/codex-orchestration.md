# Codex orchestration

Codex is the brain. Claude is the body. Codex plans and reviews from a scratch workspace it can write to,
with the repository readable but not writable;
Claude writes every line of code.

Claude Code writes code well and is weak at catching its own subtle mistakes — it wrote them, so the
reasoning that produced them still looks fine on re-reading. The fix is a **different** model doing the hard
thinking, kept out of the repository. `slopweaver dev gate` catches leak classes, PR format and retrieval regressions; it
cannot tell you a plan is wrong or that a diff has a concurrency bug. This fills that gap.

|         | Codex                                                                  | Claude                                                    |
| ------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| Role    | brain                                                                  | body                                                      |
| Access  | **reads anything; writes only its own scratch**                        | full write                                                |
| Good at | planning a hard problem, stress-testing a plan, finding subtle defects | writing code, running tests, committing, driving the loop |
| Gets    | one bounded question                                                   | the whole job                                             |

This is **built into slopweaver** as `slopweaver codex plan` and `slopweaver codex review`. The measurements
below are properties of the problem, not of any one implementation.

## Why the shape is the shape

Three runs, same model, same reasoning effort:

| run               | scope                  | diff supplied | result                                               |
| ----------------- | ---------------------- | ------------- | ---------------------------------------------------- |
| planning          | one plan               | no            | 100 exec calls, ~25 min, excellent plan              |
| review, collapsed | ~25 checks in one call | no            | 115 exec calls, **1h50m, no verdict, killed**        |
| review, narrowed  | **one property**       | **yes**       | **51 seconds**, correct finding, **zero** tool calls |

The failing run was not looping. It made 115 methodical calls and never converged: 50 `nl -ba` and 64
`sed -n` calls over 9,564 lines of whole files, when the diff itself was 5,705 lines. Whole files never
localise the reasoning, so it never knew when it was done. N properties in one call have no joint stopping
condition; one property with the material supplied has one.

One more measurement: over 87 recorded runs the plan judged _excellent_ cost 13.7M tokens and the one judged
a _catastrophe_ cost 2.8M. **The expensive one was the good one.** So there is no token ceiling, and there
never was a defensible one.

## The verbs

```bash
# A planning pass. Broad by nature — it converges on one artifact. It spends whichever registered
# destination the fleet ranking picks (`slopweaver plans list`, `codex route`), never the ambient
# `$CODEX_HOME` by default; with nothing eligible it REFUSES rather than falling through onto one.
slopweaver codex plan --pass p1 --task-file ./task.md --bound-seconds 1800

# What ran on this branch, and whether it still describes the code you have.
slopweaver codex status

# A review pass. ONE falsifiable property, against a diff the host computes.
slopweaver codex review --pass r3 \
  --property-id no-destructive-migration --property "no migration is destructive to existing rows" \
  --base origin/main --bound-seconds 240 --max-diff-bytes 262144

# Or fan out: N properties, N separate bounded calls, over the byte-identical diff.
slopweaver codex review --pass r1 --properties-file ./props.json \
  --base origin/main --bound-seconds 240 --max-diff-bytes 262144 --concurrency 4

# ONE destination's cached usage-exhaustion record — `cmux spawn --driver codex` fast-fails on it — plus
# every alias holding one, and the newest pass record with the cause it recorded: the only source that sees
# a pass refused before Codex's session started. `--plan <alias>` names the registered destination — there is
# no default, since a login found in `$CODEX_HOME` is never a plan — and a cap is per-ACCOUNT, so clearing one
# never touches another's. `show --routed` reads the row a Talk call would spend, by `talk offer`'s own route —
# the call widget's Plan left row.
slopweaver codex quota show --plan codex-one
```

`--pass` selects one of six profiles: `p1` comprehension, `p2` implementation plan, `p3` adversarial
pre-mortem, then `r1` correctness, `r2` house rules, `r3` adversarial.

The pairing is STANDING on non-trivial work (`AGENTS.md` rule 9), and the floor is
mechanical: `codex status --check` refuses a branch without a conclusive STALE `READY` plan and a CURRENT
conclusive review, and `github enqueue` / `github merge --admin` ask the same question at the mutation. When
Codex is capped, or the adopted plan register holds no Codex plan at all, each half is a Claude fallback receipt — `codex plan-fallback prepare` / `record` before the
work, `codex review-fallback prepare` / `record` after it — performed in a visible session and folded into the
same ledger marked `[claude-code]` (the owner's ruling;
[doctrine-rationale/rule-9.md § Rule 9](doctrine-rationale/rule-9.md)).

A properties file:

```json
{
  "schemaVersion": 1,
  "properties": [
    { "id": "aborted-usage-not-zero", "statement": "An aborted turn's usage is recorded as not-measured, never zero." },
    { "id": "empty-diff-refused", "statement": "A review refuses an empty diff before making any model call." }
  ]
}
```

A property must be **falsifiable by a concrete input**. "Review for data integrity" is not a property; "no
migration is destructive to existing rows" is.

## Every bound is required. There are no defaults.

`--bound-seconds` and `--max-diff-bytes` have no default and never will. A default that a machine caller
inherits silently is a habit, not a bound: it is how a 10-minute review and a 60-minute deep pass end up
sharing one accidental number that nobody chose and nobody can defend.

**The model defaults to `gpt-5.6-sol` and the reasoning effort is pinned at `medium`** (`CODEX_MODEL`,
`CODEX_REASONING_EFFORT` in `src/codex/profiles.ts`). The owner's ruling: `gpt-6-astra` spent a whole
account in under a day, so the default is `gpt-5.6-sol` for now, and a pass may name the right model for
its job with `--model <id>` — the effort stays fleet-wide. `slopweaver codex burn` measures how many sessions
each model buys per window, so the next move is made on that number. `gpt-5.6-sol` at `xhigh` caught a
`postMessage` running under both a client's default ten retries and a four-retry wrapper — roughly 44
attempts at an irreversible POST; that is evidence about that pair, not this one. If a pass starts missing
that class, re-open the effort with the owner rather than dialling it here.

**Moving the model means moving `@openai/codex-sdk` too.** The SDK vendors the `codex` binary that opens the
thread, so a model newer than that binary is refused by the API, not by us: measured,
`gpt-6-astra` on SDK 0.151.0 returned `400 invalid_request_error: "The 'gpt-6-astra' model requires a newer version of Codex"`
and every pass came back `FATAL` ten seconds in with no verdict. 0.153.3 accepts it. Check what is vendored
with `node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex --version`.

What to do about a run that does not converge depends on the ARM. For a **review**, narrow the property and do not raise the bound — a claim that cannot be settled in the bound
is usually more than one claim. For a **plan**, match the bound to the breadth of the prompt before narrowing
anything: measured, the recorded `no-conclusion-in-bound` planning passes each burned 100% of a
25-to-30-minute bound, and the one narrowing in that history halved the prompt and still did not finish. See
[codex-plan-convergence.md](codex-plan-convergence.md): [the burned bounds](codex-plan-convergence/lost-conclusion-and-review-defects.md)
and [the narrowing](codex-plan-convergence/concurrency-bounds-and-open-findings.md#4-was-right-never-raise-the-bound-was-wrong-for-planning).

## Warn, then conclude

At 85% of the bound the turn is aborted and the thread **resumed** with an instruction to conclude from what
it already has. Only then is the bound fatal. Kill-at-bound made every timeout a bet — too tight and a good
run is shot seconds from its verdict, too loose and a stray run burns an hour. Retuning the number cannot fix
that, because the right number depends on facts you only have after the run.

The warn does not extend the deadline: the wrap-up turn gets `deadline - now`. A turn that answers in the
same instant the warn fires is a success, not a breach. And a conclusion that resolves _after_ the deadline is
refused — `AbortSignal` only requests cancellation, so a slow SDK can still resolve late, and accepting that
would let a pass quietly exceed its own bound.

There is deliberately **no stall detector**. A quiet pass is not a stalled one,
and between turn-start and the first item event every activity counter is flat because usage only arrives at
turn end. A measured run died exactly there under one: 10 minutes, two events, scored as stalled, no spend recorded.

**A wrap-up turn that loses the NETWORK keeps what the pass had done, exactly as one that loses the CLOCK
does.** MEASURED on one pass artifact: the initial turn investigated
for 764,968ms, was aborted at the warn as designed, and the resumed conclusion turn then died at 24,063ms on
`unexpected status 404 Not Found` from `https://chatgpt.com/backend-api/codex/responses` — four sibling passes
on this host hit the same 404 inside half an hour, so it was a provider fault and nothing about the pass. The
twelve minutes of real work hung on nothing but which arm stopped the turn. Both the `no-conclusion-in-bound`
and `fatal` arms carry a salvage, and the type requires every construction site to state whether work was
kept, so a lossy arm cannot appear silently.

## Read the artifact, not the terminal

Every pass writes one immutable file:

```
$SLOPWEAVER_HOME/orchestration/<id>/artifact.md
```

The directory is created exclusively, the file is written to a temporary sibling and renamed into place, and
the path is printed only after that succeeds. So `artifact.md` never exists half-written: a reader finds a
complete artifact or finds nothing.

This is the fix for the failure that motivated the whole capability — answers truncated or lost with the
process. There is no aggregate index file, on purpose: an artifact plus a separate index is a two-file
transaction that cannot be made atomic, and one immutable directory per pass has nothing to reconcile.

**A review artifact records the base sha, the HEAD sha and the sha256 of the exact diff judged.** Capture is
sequential across several git commands and cannot be made atomic, so those hashes buy detectability rather
than atomicity: the moment you edit a file, every existing review artifact describes a state that no longer
exists. Re-run the affected properties.

## Branch on the verdict, never the exit code

There is **no exit code that means "answered, and the answer is BROKEN"** — 0/1/2/3 are all taken, and a
review that finds a real defect succeeded, so it exits 0. Parse the stdout JSON:

| verdict               | meaning                             | action                                       |
| --------------------- | ----------------------------------- | -------------------------------------------- |
| `CLEAN`               | the property held                   | continue                                     |
| `BROKEN`              | a concrete counterexample was found | fix, then re-run. **Never continue.**        |
| `READY` / `BLOCKED`   | plan pass outcome                   | `BLOCKED` lists its blockers in the artifact |
| `NO_VERDICT:<reason>` | ran, concluded nothing              | **not clean.** Narrow the question           |
| `FATAL`               | transport fault, cause + salvage    | a fault, not a finding — read the `cause`    |

Exit codes map onto slopweaver's existing four: `0` answered (including `BROKEN`), `2` a refusal caught before
the act phase, `3` no verdict, `1` a transport or persistence fault.

**The verdict token is never alone.** Anything short of a clean first-try answer gets one bounded clause
appended — the blocker count, the property a `BROKEN` counterexample names, the no-verdict reason plus a
salvage summary, or that a clean answer only arrived after a recovery turn (`src/codex/outcomeContext.ts`).
This is composition over data every artifact already recorded, printed on both the immediate CLI line and
`codex status`'s rows — deliberately **not** a confidence score, a retry policy, or a change to what
`codex status --check` gates on. It never quotes the model's own prose, since that is unbounded and can read
as more alarming than the finding itself; the artifact stays the one place that prose lives.

## What is refused before any spend

A review refuses — with no model call and no cost — an empty diff, one over `--max-diff-bytes`, a binary
change, a submodule pointer, an unmerged tree, or git output that is not valid UTF-8.

Refusing rather than truncating is the point: **a verdict over part of a diff reads identically to a verdict
over all of it.** A reader who does not know what was omitted cannot calibrate the answer.

## A pass reads a frozen copy, so nobody has to wait

Every pass snapshots the tree when it starts — tracked edits, staged changes and untracked files included,
ignored files excluded — and reads that instead of the live repository. The agent keeps writing; the two
cannot reach each other. The snapshot is a detached worktree at an unreachable commit: the caller's
index, working tree, stash list and refs are untouched, and an unreachable object survives until the next
`git gc`. It holds git's canonical content rather than raw working-tree bytes, so a repository configuring
line-ending filters will see them applied — that is what git itself would check out.

The worktree is LEASED, not made: each repository keeps up to eight registered slots under the OS temp
directory, and a pass moves a free one to its snapshot with `reset --hard` + `clean -ffdx`, writing only the
paths that differ from the slot's last pass rather than all 13k files per pass. A `.gitattributes` change, or
a checkout rule outside the commit (`core.autocrlf`, a filter, `info/attributes`, the global or system attributes file), or a sparse checkout or
worktree-specific config left in the slot, rebuilds the slot, a tree
with a gitlink, routed through a smudge filter or in a repository setting `core.filemode` or `core.trustctime` false (or `core.checkstat` minimal) is refused, and when every slot is leased the pass takes a fresh
throwaway worktree (`src/codex/snapshotPool.ts`). The slots stay registered between passes,
so `listWorktrees` and worktree prune omit them (`src/worktree/snapshotPoolPath.ts`).

So there is no "do not edit while a pass runs" convention: it would be unenforceable, and it is expensive —
on one measured run an agent idled seventeen minutes waiting on a pass, while on another it found a real
defect in ninety seconds during the wait.

It degrades rather than fails. Where a snapshot cannot be made the pass reads the live tree, and the
artifact says so in those words rather than implying the stronger case.

## Every pass records the tree it read

The artifact carries the branch, a fingerprint of the tree, `HEAD`, the uncommitted byte count, and which
copy was read. `codex status` turns that into one question answered in one command: which passes ran on
this branch, which are `CURRENT`, and — the part that matters — which **never ran**.

That last column exists because of a measured failure rather than a hypothetical one. A PR shipped having
skipped its plan pass and all three reviews, silently, and nobody noticed until after the merge. A table of
what happened cannot show an absence, so the absence is stated as a sentence.

The fingerprint is `HEAD` plus the working-tree patch, not `HEAD` alone: on that same PR the agent edited
for the better part of an hour without committing, so a `HEAD` comparison would have called every stale
pass current.

## The honest limits

- **Prompt injection is detectable, not impossible.** The diff is supplied as JSON-encoded untrusted data,
  the property is repeated after it, and the response must echo the exact property id — so an answer to a
  different question is rejected rather than believed. No single prompt can guarantee a model ignores
  instructions embedded in its input.
- **The sandbox bounds WRITES, not reads.** Codex reads anywhere it has filesystem permission. It writes only
  inside its per-pass scratch workspace; the repository is neither that workspace nor an additional writable
  root, which is the whole of the guarantee. Measured: a write into the repo was refused and the
  file was absent afterwards, while a read of the repo from the scratch workspace succeeded.
- **`approvalPolicy: "never"`, not the sandbox, is what blocks MCP tool dispatch** — measured under both
  `read-only` and `workspace-write`. A globally configured MCP server is still started.
- **Your prompts, repo reads and diffs go to OpenAI.** See [security/codex-boundary.md](security/codex-boundary.md).
- **The artifact reports `requestedModel` and `requestedSandboxMode`**, because the SDK reports neither the
  model actually selected nor the sandbox actually applied. Those are requests, not observations.
- **The tripwire catches a pass that fails, and one that drifts. It cannot catch one that is quietly
  wrong.** It aborts on an early burst of failures, on a miss followed by sweeping the machine, and — at any
  elapsed time — on reading other passes' artifacts, which has no innocent explanation. A pass that stays on
  topic and reasons badly looks exactly like one that reasons well.
- **A fingerprint looks at a file git will not report.** A path marked `assume-unchanged` or `skip-worktree`
  is hidden from `git diff`, so capture compares its working-tree blob to HEAD's and folds a line in when they
  differ; a marked, untouched path changes nothing. Refusing is not an option: acme-admin's postinstall marks
  `packages/web-ui/tsconfig.shared.json` on every install, so a refusal reads the landing floor `unreadable`.
- **`codex status` reports per branch, so a pass taken on a detached HEAD cannot be attributed to one.**
  Those are counted and named as unattributed rather than dropped, because a dropped pass reads as a pass
  that never ran.
- **No token totals are derived.** Which of the five usage counters overlap their parents is unverified, so
  each attempt's five raw numbers are reported separately. An aborted turn reports none of them, and renders
  as `-` with a reason — never as zero.
