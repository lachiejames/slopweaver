# Routing-preflight proof — routing as agent judgment, step 1

Recorded on a worktree carrying 5127 bytes of uncommitted patch at the time — the rule-2 rewrite from the same
run's earlier P1. This is the current-state proof gate the P2 plan requires before any routing-judgment
implementation path is touched.

## Plugin root

`slopweaver doctor` confirms the active plugin root matches this dev checkout
(`--plugin-dir dev checkout`, this worktree). No mismatch.

## Live foreign claims

`slopweaver handover list` run in full. One real proximity risk found that P1/P2 could not check (they were
sandboxed away from `$SLOPWEAVER_HOME`):

- **`bot-can-show-its-proof` is LIVE-HELD by another session right now** (session `735f4e71-…`, pid 28307, in
  the main `slopweaver` checkout, held for three days). It touches
  `src/outbound/assistant/answerForm.ts`, which handovers 6 and 8 of this plan both modify. Not a blocker
  today — this proof gate doesn't touch that file — but H6/H8 must re-check this claim before editing
  `answerForm.ts`, not assume it has cleared by the time they start.

## Related open docs — overlap, not conflict

- **`live-turn-checklist-neutral-labels`** (status ready, not blocked, not held) targets exactly the problem
  H8 names in its own scope: "the live checklist must describe judgement and selected tier rather than
  world-model retrieval." It's a smaller, standalone, already-queued fix. Recommendation: let it land on its
  own first — cheap and independent — then H8 builds tier-aware labels on top of whatever it leaves, instead
  of both docs converging on the same lines independently.
- **`retrieval-standard-shape`** names a record-identity collision bug at `src/live/turn/query.ts:140` as part
  of its own scope. H8 deletes `query.ts` entirely once corpus leaves live routing, so this bug becomes moot
  for the live path once H8 lands. Worth a one-line heads-up on that doc so it doesn't spend effort fixing a
  file about to be deleted; not a blocker here.
- **`identity-resolves-or-refuses`** flags a different `listen recover --bot-user` defect (an unresolved raw
  id) in the same file H9 rewrites (`src/live/listen/recover.ts`). Complementary, not conflicting — both
  should land without fighting over the same lines; coordinate before both are mid-flight simultaneously.

## Held queue drafts

`slopweaver queue list --json` → `{"items": []}`. Zero held drafts at the time of this check. The legacy
corpus-grounded-draft migration concern P3 raised (finding #5) has no live data to migrate against right now.
H6/H8 must still build the versioned legacy-row parser for future-proofing — a draft could exist by the time
H6 ships — but there was nothing to test against in this repository's state at the time of this proof.

## Baseline `yarn validate`

Run against the branch HEAD with the uncommitted rule-2 patch present.

First run failed on Prettier formatting of that same uncommitted patch (whitespace/emphasis-style only, no
content change — Prettier's `**"…"**` → `_"…"_` markdown-emphasis normalization). Fixed with `yarn format`;
re-run passed clean:

- `dev lint`: PASS, all 25 gates green (biome, prettier, oxlint, eslint, knip, constraints, hygiene,
  resilience-residue, boundary-residue, scheduler-bypass, no-headless, operation-labels, max-function-lines,
  named-object-params, unbounded-spread, control-bytes, git-in-tests, outbound-form-strict, jsdoc-tags,
  doc-counts, command-trigger, register-hygiene, command-meta-residue, manifest-loader-tests,
  gate-registration, coverage-ratchet, door-coverage).
- `typecheck`: clean.
- `test:unit`: 472/472 test files, 7315/7315 tests passed.
- `coverage-ratchet`: clean (floor `{"branches":66,"functions":68,"lines":70,"statements":70}`).

**Baseline passed.**

## A mechanical defect this proof gate surfaced, not named by P1/P2/P3

The P2 plan's own generated `doneWhen: - path:` probes for this handover, and for
`routing-private-source-inventory`, `routing-streaming-baseline-witness`, and `routing-witnessed-acceptance`,
all pointed at absolute paths under `$SLOPWEAVER_HOME/orchestration/…/scratch/proofs/*.json`. The probe
engine's `insideRepo` (`src/handover/evaluate.ts:82`) refuses any absolute path unconditionally — a `path:`
probe can only ever resolve against a path relative to the repository. Those four probes could never pass as
originally written, regardless of whether the file existed. This doc is the fix for this handover: the proof
lives here, inside the repository, committed, instead of in an external scratch directory. The other three
affected handovers need the same correction before they're started.
