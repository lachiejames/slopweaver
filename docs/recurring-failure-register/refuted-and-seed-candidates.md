# Refuted — 36 classes. Do not re-propose these.

Part of [The recurring-failure register](../recurring-failure-register.md).

| class                                                              | why it was refuted                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot-turn-leaves-its-thread-misrepresenting-it`                    | REFUTED — this is not one class but six, and each half already has a named, dated, tested mechanism in the tree that was built from the very anchor quoted here (`src/live/turn/indicators.ts` is literally headed "THE ONE PLACE A…     |
| `claim-shipped-without-the-anchor-that-checks-it`                  | REFUTED as specified. The class was merged too eagerly (two of six anchors are different failures with different cures), and — decisively — the detector it proposes would have caught exactly ONE of the six: three of the four…        |
| `narrowed-result-presented-as-complete`                            | REFUTED — "a cap must hand back its residue" is already the built, non-optional contract on all four lanes the class names (`ProviderReadCoverage.residue` on every live read, `truncate.ts` refuse-by-default on outbound,…             |
| `over-engineered-far-past-the-ask`                                 | The class is real and recurs hard — but it has no honest gate seam: 5 of its 6 anchors happen in conversation where no artifact exists to inspect, and the one artifact-shaped anchor is a demonstrable FALSE NEGATIVE for the…          |
| `rendered-slack-payload-escapes-the-fold-door`                     | All three merged halves are already gated, wired and tested — truncate.ts refuses ellipsis truncation by default with the exact env break-glass anchor demanded, wallGate.ts refuses consecutive runs at the slack post…                 |
| `untyped-stop-while-still-progressing`                             | The failure genuinely recurs (in both repos), but the proposed gate does not survive: its one buildable clause is a straight revert of the measured fix that created it (an earlier landed fix) and would refuse on…                     |
| `writes-into-scope-another-run-or-the-brief-owns`                  | REFUTED as proposed, but it names a real near-miss: the exact mechanism already exists as `src/measurement/overlap.ts` (`claimedPaths`/`runClaimFor` — doneWhen paths + `outputs:`, liveness-verified, repo-scoped), is already…         |
| `codex-loop-arm-skipped-and-nothing-refuses-it`                    | SUPERSEDED, and the register keeps the refutation because the reasoning was right when it was made. Two of its three grounds still hold; the third — "the decision NOT to wire it to the PR door" — was reversed by the owner's…         |
| `escape-hatch-missing-or-hidden-in-a-global-env-var`               | REFUTED — the escape-hatch half is already enforced at the TYPE level (src/admit/types.ts makes `override` a required field of every `warn` finding, so a refusal without a hatch does not compile) and the registry half by the…        |
| `proceeds-without-the-context-it-was-told-to-load`                 | REFUTED on three independent grounds: half of the merged class SHIPPED and every one of its anchors predates that landing; the two halves were merged too eagerly (the sweep anchors are a…                                              |
| `slack-answer-composed-on-an-incomplete-or-stale-thread-read`      | Already gated on the exact path every anchor describes: `threadFreshnessRefusal` in `src/cli/commands/turn/postAnswer.ts` re-reads the thread LIVE immediately before `turn answer` posts and REFUSES on any new non-bot message, and…   |
| `supersede-drops-what-the-predecessor-earned`                      | REFUTED on the seam and weak on recurrence: the `supersedes:` front-matter key the proposal calls "already in use and parsed by src/handover/doc.ts" does not exist anywhere — `parseHandoverDoc` reads a closed key set that omits…     |
| `destructive-git-shape-the-classifier-does-not-know`               | REFUTED as merged — it is three unrelated failures wearing one name: the `reset --soft` half is already gated twice at a better seam (`revertsMainFindings` in src/outbound/github/mergeGuard.ts refuses it at `github merge`, with…     |
| `scratch-tooling-written-in-python-or-shell`                       | It does not survive: the anchors collapse from 4 instances to ~2 (three of them are one episode quoted three times, and the fourth is the owner running a script personally, not an agent authoring one), and the detector…              |
| `found-defects-listed-not-fixed-in-the-same-pr`                    | The class is real, ungated and recurs more than the four anchors claim — but the proposed seam cannot see it: a PR body here is a byte-exact render of a CLOSED typed form (title/target/draft/badges/next/problem/solution/proof),…     |
| `known-flake-read-as-this-branchs-breakage`                        | REFUTED on three independent grounds: the anchored flake class was closed at its mechanism (config/vitest/subprocess.ts `retry: 1` + `maxWorkers: 4` + `testTimeout: 60_000`) and at its cause (`git-in-tests` +…                        |
| `memory-written-without-the-scope-that-makes-it-false`             | Refuted on three independent grounds: the subsystem already exists (`src/memory/` + a wired PostToolUse-on-Write hook), the exact detector proposed was already built, measured against a real corpus, and rejected for false…           |
| `session-ends-with-work-uncommitted-or-unpushed`                   | Does not survive: two of the four anchors are not failures at all but artifacts of the deleted headless `claude -p` fleet driver (one is a machine-generated resume prompt the miner scraped as a user turn, one the owner explicitly…   |
| `two-sessions-on-one-worktree-or-a-stale-one-reused`               | REFUTED as merged: it bundles four distinct failures, of which the main-checkout half is already gated four ways in both repos, the stale-worktree-reuse half is DELIBERATE design plus an explicit owner ruling against refusing it,…   |
| `shipped-but-never-wired-into-the-live-path`                       | REFUTED on all three axes: the named seam does not do what the proposal says it does (gateRegistration.ts is a Set difference on two filename lists, not a walk), the half that IS detectable is already gated — by…                     |
| `rich-card-flattened-through-the-generic-answer-schema`            | Refuted on all three counts: the four anchors are one incident inside a 48-hour window, that incident was structurally closed by a change which added `index`/`indexStyle` to `answerArmSchema` so the…                                  |
| `live-brief-rewritten-mid-run-instead-of-a-new-row`                | Refuted on all four axes: the "recurrence" is a merge of three classifier keys, 12 of the 19 instances coming from `other-amendment-reason`, which `src/reflect/finding.ts` documents as its deliberate heterogeneous catch-all; the…    |
| `conversational-owner-ask-never-becomes-a-row`                     | It does not survive: a mechanism built for this exact incident landed ("One board: a tag is a row, an ask is a row") and quotes these anchors verbatim as its own motivation —…                                                          |
| `sendfeedback-drafts-written-into-a-sink-nothing-reads`            | REFUTED on three independent grounds: the statement is factually false (two shipped collectors read the drafts daily and a shipped acme-admin recipe consumes them into a dated morning report), the class is already an open board doc… |
| `blocks-a-relayed-instruction-on-sender-identity`                  | It does not survive: every anchor is from a single ~2-hour window, the doctrine fix that covers it landed the next morning, zero instances appear in the 9 days since across 1,554 transcripts —…                                        |
| `proof-media-does-not-show-what-it-claims`                         | REFUTED as proposed — it fails on all three disqualifiers at once, though a thin residue is real and belongs somewhere else.                                                                                                             |
| `whole-file-read-blows-the-token-cap`                              | REFUTED — not gated anywhere (that part is true), but it fails on shape, on evidence, and on its seam.                                                                                                                                   |
| `run-executes-a-doc-whose-premises-the-repo-contradicts`           | REFUTE as proposed — but there is a real salvage, and it is an EXTENSION, not a new gate.                                                                                                                                                |
| `worker-substitutes-its-own-judgement-for-a-stated-owner-decision` | REFUTED on three independent grounds, any one of which sinks it.                                                                                                                                                                         |
| `done-declared-on-evidence-that-could-not-have-failed`             | REFUTED on three independent grounds — do not send to ranking as a new gate.                                                                                                                                                             |
| `handed-over-prompt-names-no-destination`                          | REFUTED on all four axes. (a) The seam named is wrong: I opened `src/handover/render.ts` — it emits ZERO fenced blocks (`grep -c '```' src/handover/render.ts` → 0) and is the _board_ renderer, whose RUN NOW row already prints…       |
| `second-listener-started-without-checking-for-a-live-one`          | REFUTED — this is already gated twice, wired end-to-end and unit-tested, and both gates landed AFTER the newest anchor, so the class is fixed history rather than a live recurrence: `socketConnectionPermit`…                           |
| `team-facing-pr-opened-with-no-linear-ticket`                      | REFUTED — already gated, server-side, at a strictly stronger point than the proposed seam, in the only repo where the failure lives.                                                                                                     |
| `supervisor-does-the-leaf-work-instead-of-spawning`                | REFUTED on two independent grounds — already gated (in canon, deliberately) and the seam does not exist.                                                                                                                                 |
| `published-doc-shipped-without-opening-it-rendered`                | REFUTED on three independent grounds — recurrence, coverage, and seam ordering.                                                                                                                                                          |
| `bulk-applies-bot-review-comments-without-judging-them`            | REFUTED on three of four checks. (1) ALREADY COVERED, twice over. In slopweaver, CodeRabbit is disabled repository-wide via the committed `.coderabbit.yaml` (`auto_review.enabled: false`, `inheritance: false`), and…                  |

## Filed separately, folded in here rather than duplicated

- `invented-images-are-refused-like-raw-gh` — has its own handover doc; do not re-file it.
- `workers-wait-with-checks-wait-not-sleep-polls` — has its own handover doc; do not re-file it.
- `dd-monitor-proof-belongs-to-port-monitor-governance-to-staging` — has its own handover doc; do not re-file it.
- `fan-out-saturates-the-host-that-runs-it` — added from a peer report, measured in the mining session itself. A session fans out enough concurrent agents that the HOST degrades — each agent spawning tsx preflight plus PreToolUse hook compilations in one worktree — and every other session on the machine…

## Two seed candidates that already have partial mechanism

- **Review rounds capped** — `src/live/turn/reviewRounds.ts` already narrows what a LATE round may be about past
  `REVIEW_ROUND_CAP`, but deliberately never refuses round N+1. A hard cap is an extension of that file, not a new
  gate. (`bot-answer-review-rounds-uncapped`.) **Two more mechanisms landed beside it for a later
  recurrence, and neither is a cap**: `src/live/turn/leaseJudgement.ts` holds the clock while a reviewer is
  mid-verdict, while a clean verdict binds to the answer in hand, or while the review
  RECORD is open at all, which is the window BETWEEN two rounds where the first has returned `broken` and the
  next has not opened yet; and `src/live/turn/answerFreeze.ts` refuses an edit
  that would discard a verdict the door would accept as it stands until `turn resume --edit-reason` states why,
  journalling the reason. The measured recurrence they came from ran five rounds
  with outcomes `broken`, `broken`, `clean`, `clean`, `broken`, the answer rewritten after every one of them, and
  lost the turn four minutes past a two-hour lease of which ninety minutes had been review. Note what that same
  incident REFUTES: "a clean verdict ends the review" would have posted at round three an answer round five found
  broken on its core deliverable. A later recurrence is what added the third hold and is frozen as
  `fixture:lease-expires-while-a-review-round-is-open`: round 1 returned `broken` 1.022 seconds after the lease
  lapsed, so `inFlight` was false and no verdict was usable, and three sweep laps crossed that window over 9m41s
  before `releasedAt` was stamped 37 minutes later. That ask was in fact ended by a `failed` row `turn answer`
  itself wrote off an admit-door refusal, not by the sweep — a separate defect with its own row.
- **A thread never left hanging** — `src/live/ask/lifecycle.ts` already types `lease-expired`, `dispatch-failed`
  and `dispatch-unwitnessed` as candidates rather than endings, and `turn dispatch --sweep` surfaces them. The gap
  is that nothing forces the sweep to have run. (`stalled-session-still-reported-as-in-flight`.)

## Two latent gaps found while verifying, not from the transcripts

- `docProblemsRefuse` (`src/cli/commands/handover/lifecycle.ts`) is called by `finish` and `resume` but NOT by
  `start`. **The conclusion first drawn from that was WRONG and is corrected here** rather than quietly
  deleted, because [this file](../recurring-failure-register.md)'s whole value is that a dead claim stays visible. It said `handover start` would
  open a run on a doc whose `doneWhen` never parsed. It does not: `start` calls `blockerFor` (`handover/doc.ts`)
  and refuses on `blockingKind`, and a doc whose front matter did not parse arrives as the `malformed` blocker
  kind, which carries its own `problems` list. The REAL residue is narrower and still worth fixing — the
  refusal logs `blocker.kind` alone, so a reader is told "malformed" and never which key was wrong. Scope the
  probe-at-write gate to that, plus the class's other seven anchored instances. Verified by a second
  session on its own doc, then re-checked here by reading both call sites.
- `runSeed` writes records and members but never calls `writeSubsetManifest`, so no reader can tell a demo corpus
  from a real one.
