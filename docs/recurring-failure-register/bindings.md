# Bindings

Part of [The recurring-failure register](../recurring-failure-register.md).

**What binds each live class to something that would go RED.** One row per class in [Survivors](survivors.md), [Gated](gated.md) and the
owner-ruled additions ([the mining-pass follow-ons](owner-ruled-additions.md), [the silent-check family](silent-checks.md)), and the `register-bindings` gate in `yarn lint` refuses a class with no
row, a row naming a class no section carries, a target that does not resolve, and a Survivor row claiming
`closes`. The count below is COMPUTED by that gate on every run, never restated here: read it off the gate's
own clean line.

**Why the table is here rather than a `binds` cell on each row.** The live classes are spread over four
different grammars — three pipe tables with different columns, plus prose bullets in two sections — so a
per-row field is four parses, and the fourth is unbounded prose. One table is one parse, in the shape
`docs/security/credentials.md`'s tokens table already proves stays stable under Prettier. The cost is honest: this is a
fourth surface a class can drift out of, which is exactly why the gate checks the join in both directions
rather than trusting it.

**`none` is a real answer and most rows are it.** A class nothing binds says `none` rather than leaving a
blank, because a blank cell in a formatted table is indistinguishable from a row somebody half-wrote. The
unbound list is meant to be uncomfortable — it is what "22 unbuilt classes" looks like once it is computed
instead of remembered. It is NOT a backlog until somebody decides it is one; nothing here opens a board row.

**Strength is a claim about the target, and `closes` is the one the gate acts on.** `closes` — the class
cannot recur through this seam. `narrows` — partially closed, the honest value for most real mechanisms.
`witnesses` — a test or fixture goes red if it regresses, with nothing refusing it up front. `none` — pairs
with `binds: none`. A Survivors row claiming `closes` is refused, because this file's own rule is to move a
class out of [Survivors](survivors.md) once its gate lands.

| class                                                                      | binds                                                                                                                                                                                  | strength  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `parks-on-the-owner-for-what-it-could-do-itself`                           | none                                                                                                                                                                                   | none      |
| `outbound-claim-ships-without-its-evidence`                                | none                                                                                                                                                                                   | none      |
| `unverified-absence-impossibility-or-blocker`                              | none                                                                                                                                                                                   | none      |
| `verification-run-in-a-shape-whose-green-means-nothing`                    | none                                                                                                                                                                                   | none      |
| `door-bypassed-or-its-skill-never-loaded`                                  | none                                                                                                                                                                                   | none      |
| `wall-of-text-on-a-surface-no-form-governs`                                | none                                                                                                                                                                                   | none      |
| `passes-keep-running-instead-of-building`                                  | none                                                                                                                                                                                   | none      |
| `bot-answer-review-rounds-uncapped`                                        | `test:src/__tests__/unit/live/turn/reviewRounds.test.ts fixture:rewrite-after-clean-verdict-loses-the-lease fixture:lease-expires-while-a-review-round-is-open`                        | narrows   |
| `feedback-closed-without-locking-in-the-class`                             | none                                                                                                                                                                                   | none      |
| `long-run-piped-or-unwatched-so-nobody-sees-it`                            | none                                                                                                                                                                                   | none      |
| `stalled-session-still-reported-as-in-flight`                              | `fixture:dispatch-orphan-28aug fixture:card-posted-never-dispatched fixture:long-dispatch-no-warn-12sep fixture:pickup-unwitnessed-2sep fixture:worker-died-mid-response-10sep`        | witnesses |
| `pr-state-asserted-or-acted-on-from-a-partial-read`                        | none                                                                                                                                                                                   | none      |
| `finished-sessions-and-runs-are-left-open`                                 | none                                                                                                                                                                                   | none      |
| `idle-or-scheduled-work-declared-with-no-durable-wake`                     | none                                                                                                                                                                                   | none      |
| `fleet-size-judged-by-a-heuristic-not-a-measurement`                       | none                                                                                                                                                                                   | none      |
| `errors-swallowed-into-empty-defaults`                                     | `gate:no-silent-fallback`                                                                                                                                                              | narrows   |
| `quality-claim-from-a-toy-corpus`                                          | none                                                                                                                                                                                   | none      |
| `door-gate-fires-only-at-post-time-after-the-work-is-spent`                | none                                                                                                                                                                                   | none      |
| `stacked-prs-are-not-github-native-stacks`                                 | none                                                                                                                                                                                   | none      |
| `owner-facing-row-asserts-state-it-never-re-read`                          | none                                                                                                                                                                                   | none      |
| `verdict-computed-against-the-wrong-tree`                                  | none                                                                                                                                                                                   | none      |
| `probe-missing-or-malformed-at-write-time`                                 | `test:src/__tests__/unit/handover/absoluteProbeTarget.test.ts test:src/__tests__/unit/handover/openRunProbeGap.test.ts`                                                                | narrows   |
| `re-derives-or-rebuilds-what-already-exists`                               | `test:src/__tests__/unit/cli/commands/github/alreadyLandedRun.test.ts test:src/__tests__/unit/cli/commands/github/createAlreadyLanded.test.ts`                                         | narrows   |
| `voice-rules-run-late-and-only-on-one-lane`                                | `test:src/__tests__/unit/outbound/voice/belowFold.test.ts test:src/__tests__/unit/cli/commands/github/aboveFoldGate.test.ts`                                                           | narrows   |
| `module-anchored-repo-lookup-in-a-runtime-verb`                            | `gate:running-checkout-root test:src/__tests__/unit/devLint/runningCheckoutRoot.test.ts test:src/__tests__/subprocess/lib/pluginMirrorRoot.test.ts`                                    | closes    |
| `code-under-proof-is-not-the-code-you-edited`                              | `test:src/__tests__/subprocess/scripts/binSlopweaverForeignCli.test.ts`                                                                                                                | narrows   |
| `decision-ask-arrives-unanswerable`                                        | `test:src/__tests__/unit/briefing/cardSubject.test.ts`                                                                                                                                 | narrows   |
| `slack-ts-hand-converted-to-iso`                                           | `gate:epoch-arithmetic test:src/__tests__/unit/lib/slackTs.test.ts test:src/__tests__/unit/devLint/epochArithmetic.test.ts test:src/__tests__/unit/handover/askRow.test.ts`            | closes    |
| `dependabot-alert-cited-as-a-pull-request-url`                             | `test:src/__tests__/unit/outbound/linkify/bareRefsAlertNumbers.test.ts`                                                                                                                | closes    |
| `outbound-figure-asserted-with-no-measurement`                             | `test:src/__tests__/unit/outbound/assistant/measuredFigures.test.ts test:src/__tests__/unit/outbound/assistant/parseAnswerArm/measuredFigures.test.ts`                                 | narrows   |
| `outbound-small-sample-figure-stated-without-its-n`                        | `test:src/__tests__/unit/outbound/assistant/smallSamples.test.ts test:src/__tests__/unit/outbound/assistant/parseAnswerArm/smallSamples.test.ts`                                       | narrows   |
| `test-fixture-mints-a-temp-dir-with-no-cleanup`                            | `test:src/__tests__/unit/tempRootSandbox.test.ts test:src/__tests__/subprocess/lib/tempRootInheritance.test.ts`                                                                        | closes    |
| `a-land-slower-than-the-base-cadence-cannot-land-unheld`                   | none                                                                                                                                                                                   | none      |
| `as-me-public-post-fragments-and-degrades`                                 | none                                                                                                                                                                                   | none      |
| `parked-question-anchors-freeze-against-live-state`                        | none                                                                                                                                                                                   | none      |
| `waiter-reads-empty-as-cleared`                                            | none                                                                                                                                                                                   | none      |
| `bot-login-suffix-differs-by-api-surface`                                  | none                                                                                                                                                                                   | none      |
| `refusal-recommends-a-key-shape-that-cannot-work`                          | none                                                                                                                                                                                   | none      |
| `blast-radius-claimed-from-a-passing-test`                                 | none                                                                                                                                                                                   | none      |
| `sweep-reported-done-without-a-residual-rescan`                            | none                                                                                                                                                                                   | none      |
| `claim-corrected-in-a-reply-not-in-the-artifact`                           | none                                                                                                                                                                                   | none      |
| `claim-fans-out-before-it-is-verified`                                     | none                                                                                                                                                                                   | none      |
| `bulk-delete-by-prefix-takes-a-named-entry`                                | none                                                                                                                                                                                   | none      |
| `pre-push-gate-runs-inside-the-open-transport`                             | `test:src/__tests__/unit/cli/commands/github/pushRun/runGithubPushGateAndBase.test.ts`                                                                                                 | closes    |
| `autolinker-resolves-a-cross-repo-number-into-the-wrong-repo`              | `test:src/__tests__/unit/outbound/linkify/bareRefs.test.ts`                                                                                                                            | narrows   |
| `an-answer-posted-off-the-answer-lane-is-invisible-to-every-answered-test` | `test:src/__tests__/unit/live/listen/answeredInThread.test.ts`                                                                                                                         | narrows   |
| `public-ask-dispatched-with-no-live-progress-card`                         | `fixture:dispatched-with-no-live-card-21sep test:src/__tests__/unit/cli/commands/turn/ensureCard.test.ts test:src/__tests__/unit/live/listen/dispatchedCardFrame.test.ts`              | narrows   |
| `tooling-shipped-before-the-public-ask-was-answered`                       | `test:src/__tests__/unit/live/turn/answerFirst.test.ts test:src/__tests__/unit/live/turn/answerFirstBrief.test.ts test:src/__tests__/unit/cli/commands/github/answerFirstGate.test.ts` | narrows   |
| `check-cannot-tell-passed-from-did-not-run`                                | none                                                                                                                                                                                   | none      |
| `check-answers-a-narrower-question-than-its-claim`                         | none                                                                                                                                                                                   | none      |
| `lookup-answers-a-different-question-in-the-right-shape`                   | none                                                                                                                                                                                   | none      |
| `integrity-check-reads-unknown-as-unchanged`                               | `test:src/__tests__/unit/retrieval/fanout.test.ts`                                                                                                                                     | witnesses |
| `one-item-failure-sinks-the-whole-batch`                                   | `test:src/__tests__/unit/live/slack/download.test.ts`                                                                                                                                  | witnesses |
| `two-normalisers-decide-sameness`                                          | `test:src/__tests__/unit/store/identityMatching.test.ts`                                                                                                                               | witnesses |
| `single-use-constant-handed-over-as-current`                               | none                                                                                                                                                                                   | none      |

**What a `test:` target actually proves, and what it cannot.** The gate checks three things: the path is
tracked, it is COLLECTED by one of the three vitest lanes (a `*.test.ts` the lane globs miss is silently
never run, and a binding to an uncollected file is a binding to nothing), and the file NAMES this class —
either literally, or through a `// register-class: <name>` marker line. That marker is not an exemption; it
is the join token, and `grep -rn "register-class:" src/__tests__/` reads the relation from the test's side.
What none of it proves is that the test would go red if the class regressed. Nothing static can, and a gate
that implied otherwise would be worth less than this one.

**Filename matching is NOT a substitute, and that was measured.** Breaking the alert-context regex — exactly
the defect `dependabot-alert-cited-as-a-pull-request-url` describes — left `bareRefs.test.ts` 58 of 58 green.
The file that caught it is `bareRefsAlertNumbers.test.ts`. Nothing short of a declared link answers which
test binds which class.

**A fixture's own end of the join, and the one boundary it puts on "never hand-edit a fixture".** A replay
fixture declares what it regresses in its manifest's `regresses` field, written by `slopweaver turn freeze
--regresses <class>`, which refuses a class [this file](../recurring-failure-register.md) does not carry. `.claude/rules/testing.md` § the replay
lane says never to hand-edit a fixture, and **that rule's subject is the REDACTION** — its hazard is a hand
edit reintroducing a real id the allowlist would have caught. So every byte under `home/`, and every manifest
field DERIVED from the record set (`replayNowIso`, `files`, `syntheticIdCount`, `reviewRounds`,
`withheldEventKinds`), may only be re-frozen. A field the FREEZER supplies whose vocabulary is CLOSED —
`slug`, `through`, `regresses` — may be corrected by hand, because a value that must already exist in a
committed document cannot carry a private id, and the gate refuses one that does not. `incident` is
freezer-supplied and is deliberately NOT in that set: it is free prose, so it is redacted and re-frozen like
the rest. That boundary is why the four OLDEST fixtures regressing
`stalled-session-still-reported-as-in-flight` could declare it at all — their source state homes are long
gone, so re-freezing them was never available. `worker-died-mid-response-10sep` is the first of that class
whose home was still on disk, so it declared the class at freeze time and needed no correction.

## Keeping it current

Append [here](../recurring-failure-register.md) when the daily self-improvement report surfaces a class that recurs; move a class out of [Survivors](survivors.md)
when its gate lands, naming the gate. A class whose gate exists belongs in the dedupe list, not the build list.

**A new class owes a `## Bindings` row in the same change** — `none`/`none` when nothing binds it yet, which
is the common and honest case. `register-bindings` refuses a class without one, so this is not a convention
anybody has to remember. When a class's mechanism lands, move it to [Gated](gated.md) AND update its row's targets and
strength together; the gate refuses a Survivors row claiming `closes`, which is this rule enforced rather
than restated.

**A replay fixture declares what it regresses** in its own manifest's `regresses` field, and `turn freeze
--regresses <class>` writes it. That is the other direction of the same join: the gate refuses a fixture
naming a class [this file](../recurring-failure-register.md) does not carry, and a bindings row naming a fixture that does not name it back.
