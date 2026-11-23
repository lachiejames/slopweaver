# Retiring a property WORDING — `codex supersede`

A review property containing an **unbounded quantifier has no fixed point**. Each round the reviewer finds a
deeper hiding place, the loop never converges, and the fault is the property rather than the code. This verb
is how that ends without anybody quietly softening a real finding.

This was chosen over making `codex status --check` read only the latest verdict per property id.

## What it took to learn this, measured

On one pull request, a property asked that the request uuid be carried "wherever GitHub supplied one
ANYWHERE in the response". The reviewer answered `BROKEN` three times running, moving the uuid one level
deeper each time: top-level, then `details.request.uuid`, then a fabricated
`{"a":{"b":{"c":{"d":{"uuid":"req-123"}}}}}`. No bounded search wins that, and an unbounded walk over an
arbitrary structure is a worse thing to own than a lost id.

The same property scoped to GitHub's documented schema returned `CLEAN` immediately. **Six earlier rounds
under bounded properties found six real defects and converged.** So the reviewer was working correctly
throughout; the wording was the defect.

## Why a verb and not "read the latest verdict"

Reading only the latest verdict per property id clears a blocking `BROKEN` the moment anyone re-runs the id —
**including with weaker wording, silently, leaving nothing on the page to show it happened**. That is the
goalpost-move the gate exists to prevent. This verb costs one sentence and keeps that sentence forever.

## The three properties that keep it from being an escape hatch

**It retires one ARTIFACT, never a property id.** A future pass under the same id is untouched, so a finding
cannot be pre-emptively waived.

**It REFUSES without a replacement.** A current, conclusive pass under the same property id must already
stand. The shape is therefore always "this wording was replaced by that one", never "this finding is
dismissed" — and a replacement may itself be `BROKEN`, because a retirement is about the WORDING and not the
answer.

**A retired pass stays VISIBLE.** It is never deleted and never hidden. `codex status` keeps printing its row,
its verdict and its freshness, and adds two lines naming what replaced it and why. Only the landing gate
stops counting it — in BOTH directions: a retired pass cannot block a landing, and cannot satisfy the review
floor either.

```bash
codex supersede --artifact <id> --reason "<why the wording could not be satisfied>"
```

**It reaches a Claude fallback review receipt too, by receipt id.** A receipt
([claude-fallback-review.md](claude-fallback-review.md)) is a review row the floor counts like any other under
the standing fallback rule, so it is a row this verb retires like any other — same three properties, same two
refusals, `--artifact <receiptId>` (the id `codex status` prints on the `[claude-code]` row). A ledger built from pass records alone could
never retire a CURRENT `BROKEN` receipt, and would shut the landing floor for as long as Codex stayed capped,
a CLEAN replacement receipt standing beside it (measured).

The register is the store's `codex_supersession` table, insert-only and keyed by artifact id: re-running the
same retirement succeeds, a DIFFERENT one of an already-retired pass is refused. The run directories under
`orchestration/` stay immutable — a retirement is a row beside them, never an edit to one, so the pass is
still there to read and the retirement is still there to see. The old `codex-supersessions.jsonl` is imported
once, on the first operation. A store that cannot be reached, or a row that will not decode, fails every
reader CLOSED — `codex supersede`, `codex status --check` and both landing verbs refuse rather than judge a
ledger without knowing which passes are retired, and a review's property-chase line is skipped and says why.

## A pass that recorded NO TREE — the same verb, a stricter replacement

A pass whose tree capture failed cannot be placed on any branch, so `codex status --check` and both landing
verbs fail closed on it for its WHOLE checkout: it could have been the newest `BLOCKED` plan. The rule is a supersede verb that retires a no-tree record with its reason, explicit and journalled, the
gate failing closed by default, chosen over quietly not counting it once a later pass captured a tree.
MEASURED: 20 of 504 plan passes over ten days recorded no tree, and one landing needed
`SLOPWEAVER_ALLOW_UNREVIEWED` beside a placed READY p2 and CLEAN reviews because nothing could retire one.

The refusal names each record's artifact id and checkout. Retire one with the same command, from that
checkout (`--repo`). It is **refused unless a STRICTLY LATER, conclusive pass of the same kind, with tree
provenance, stands on this branch** — a plan may be stale, a review must be current and under the same
property id. A record newer than every placed pass could still be the latest word, so it stays counted until
you re-run. The row names the branch its replacement stood on and retires the record for THAT branch only,
and only a `no-tree` row retires one — a wording row keyed by the same id proves nothing about it. `codex
status` lists every no-tree record under `NO TREE:`, retired ones with their reason.

## Two refusals worth knowing before you reach for it

**A STALE pass is refused**, because it already counts for nothing and the row would record a decision that
changes nothing. This bites more often than it sounds: editing any file makes every pass on the branch stale,
so a block you meant to retire can dissolve on its own while you write the fix. That is not a success — it is
the accidental version of the same goalpost-move, and the honest move is to notice it out loud.

**A second retirement of the same pass is refused.** One row retires it once, and the row is permanent.
