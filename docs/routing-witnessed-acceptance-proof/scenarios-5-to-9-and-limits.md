# 5 — Captured but unanswered recovery

Part of [Routing witnessed-acceptance proof](../routing-witnessed-acceptance-proof.md).

1. **AskIdentity:** fixture identities in `recover/fixtures.ts` (live), non-private.
2. **Invocation:** `yarn test:unit` — the `started`-propagation case in
   `src/__tests__/unit/live/listen/recover/classifyCandidate.test.ts` and the `already-resolved` cases in
   `src/__tests__/unit/live/listen/recover/classifyLifecycle.test.ts`.
3. **Judgement:** n/a until a `turn brief` replay decision is made downstream of recovery.
4. **Tier/execution:** n/a.
5. **Supervisor:** n/a — recovery runs in the SAME visible session that later re-judges.
6. **Lifecycle:** a candidate whose ask-lifecycle entry carries a `started` checklist has that SAME
   `StartedChecklist` (`turnId`/`workingTs`) copied onto the recovered `Mention`, so `briefReplayCommand`
   appends `--turn-id`/`--working-ts` — a resumed capture, not a second one. A candidate already resolved as
   `triaged-no-response`/`left-for-a-human`/`withheld` is excluded (`already-resolved`); one a turn is holding
   right now is excluded (`in-flight`); one already worked to `failed`/`dispatch-failed`/`lease-expired` is
   excluded (`already-worked`). The non-terminal cleanup intents (`triage-cleanup-intended`,
   `handover-cleanup-intended`) remain explicitly NOT excluded, matching
   `../../src/live/ask/lifecycle.ts`'s own documented intent that a sweep or recovery pass is exactly what should
   find it still pending.
7. **Slack evidence:** the `started` carry-forward is what keeps a RESUMED capture from starting a second
   turn, and it is not on its own what keeps a duplicate CHECKLIST off the thread — measured: a
   recovery re-capture posts its own capture checklist through the shared capture chain long before
   `briefReplayCommand` is reached, and the first turn finalises only its own. The exclusions in 6 are what
   actually close that: a candidate with a live or already-worked lifecycle entry never reaches capture.
8. **Transport evidence:** `recoverSlackAsks` (the extracted effectful scan) is exercised over plain
   `SlackApi` fakes in `recover/threadReplyDiscovery.test.ts` and `recover/breadthIsNotPermission.test.ts`,
   and its pure classification layer in `recover/classifyCandidate.test.ts` and
   `recover/classifyLifecycle.test.ts`; the live Slack-touching half follows this repo's established
   "hardwired, proven live" precedent.
9. **Witness result:** STRUCTURAL PASS / OWNER TODO. The proof boundary: the classification and
   identity-propagation logic is proven exactly; a real off-listener capture followed by a real recovery pass
   finding the SAME checklist timestamp is not yet witnessed live.

## 6 — Off-period recovery

1. **AskIdentity:** fixture identities in `recover/fixtures.ts`/`pagination.test.ts`, non-private.
2. **Invocation:** `yarn test:unit` — `src/__tests__/unit/cli/commands/listen/recover.test.ts` (CLI),
   `src/__tests__/unit/live/listen/recover/breadthIsNotPermission.test.ts` and
   `src/__tests__/unit/live/listen/recover/threadReplyDiscovery.test.ts` (live),
   `src/__tests__/unit/live/slack/pagination.test.ts` describe block `fetchCompleteSlackHistory` (8 cases).
3. **Judgement:** n/a until replayed.
4. **Tier/execution:** n/a.
5. **Supervisor:** n/a — the sweep runs when the visible session next starts, after the off-period gap.
6. **Lifecycle:** a candidate with NO prior `captured` row (never seen live) is found purely from
   `conversations.history`, classified, and — if recoverable — reaches `briefReplayCommand`'s exact
   `turn brief` invocation. `fetchCompleteSlackHistory`'s completeness contract (cursor exhaustion only,
   cross-checked against `has_more`; a repeated or missing-but-promised cursor refuses rather than returning a
   partial page) is proven directly: exhaustion, a zero-item page with a live cursor, a `has_more`
   contradiction, a repeated cursor, a thrown later page, and per-page progress reporting.
7. **Slack evidence:** n/a for this scenario's own coverage.
8. **Transport evidence:** plain fakes serving explicit pages, asserting the exact window (`oldest`/`latest`)
   requested — never a real network call in this lane.
9. **Witness result:** STRUCTURAL PASS / OWNER TODO. The proof boundary: pagination completeness and
   candidate classification are proven exactly; a real tag sent while no listener was running, later found by
   a real recovery sweep, is not yet witnessed live.

## 7 — Static metadata checklist after redesign

1. **AskIdentity:** SAME as scenario 1 — this scenario's mechanical half is proven by the SAME cassette.
2. **Invocation:** SAME as scenario 1 (`turnInlineCompletion.test.ts`), plus
   `src/__tests__/unit/live/turn/completionLifecycle.test.ts` (4 cases) for the pure projection half.
3. **Judgement:** SAME as scenario 1.
4. **Tier/execution:** SAME as scenario 1.
5. **Supervisor:** SAME as scenario 1.
6. **Lifecycle:** identical to scenario 1's — `answered`, reached via `lifecycleEventForCompletion`, now
   extracted into its own module so the integration lane builds the EXACT production projection rather than
   recreating an approximation of it, and proven to read identity from `completion.askIdentity` rather than
   any separately supplied `Mention`.
7. **Slack evidence:** the checklist's exact redesigned tier text is not asserted verbatim here (this test
   asserts structure/identity, not prose), but the checklist post → update → delete sequence is the SAME real
   transport calls scenario 1 lists. Both recorded checklist responses carry `slopweaver_turn_v1` metadata
   with renderer `slack-turn-v1`.
8. **Transport evidence:** SAME as scenario 1's ordered write sequence (`assistant.threads.setTitle` through
   `chat.delete`).
9. **Witness result:** STRUCTURAL PASS / OWNER TODO. The proof boundary is stated explicitly in
   `turnInlineCompletion.test.ts`'s own header: this proves the static checklist posts, advances, and is confirmed
   deleted after a real answer replaces it — never that the owner visibly watched the checklist text advance
   in a real Slack client, which is a live-witness claim a cassette replay cannot establish.

## 8 — Expired fresh-session lease

1. **AskIdentity:** fixture identity in `dispatch/sweepAndPoll.test.ts`, realistic and non-private.
2. **Invocation:** `yarn test:unit` — `src/__tests__/unit/cli/commands/turn/dispatch/sweepAndPoll.test.ts` describe block
   `turn dispatch — sweepDispatchedAsks surfaces an expired lease, never relaunching` (3 cases).
3. **Judgement:** first: `{"response":"respond","tier":"read-only-subagent",...}` under an already-expired
   lease. Re-judgement: `{"response":"respond","tier":"inline",...}`.
4. **Tier/execution:** `sweepDispatchedAsks` is now an exported, independently testable driver taking
   `DispatchSweepDeps` (`nowIso`/`freshScreenTruth`/`writeLine`) — a type with NO spawn/relaunch capability,
   so "never relaunches anything" is a fact the type system enforces, not merely a convention `runSweep`
   happens to follow. `isLeaseExpired`/`executeTier`/`sweepDecision` are unchanged.
5. **Supervisor:** the plain-fake screen reader is called exactly once per sweep (asserted directly) — the
   equivalent of "the cmux workspace count did not increase" for a fake rather than a real workspace.
6. **Lifecycle:** `dispatched(fresh-visible-session, expired)` → `lease-expired` (asserted as the fold's exact
   last event, with the exact emitted line `lease-expired (re-judgement candidate): <channel>/<messageTs>`
   and summary `sweep: 0 ready, 0 still working, 0 phantom, 1 lease-expired, 0 checklist-update-failed`) →
   re-judged
   `dispatched(inline)` for the SAME identity via the real `turn dispatch --brief/--decision` path. A separate
   case runs the real `turn dispatch --sweep` CLI argv/manifest path over an expired ORPHAN record (no
   current dispatch file), reaching `EXIT_OK` without ever touching cmux.
7. **Slack evidence:** n/a — a sweep only reads the local ask-lifecycle log and (for a `fresh-visible-session`
   dispatch with a current record) the cmux screen; no Slack call.
8. **Transport evidence:** none in this scenario's own tests, by design — `DispatchSweepDeps` cannot express a
   relaunch, so there is nothing for a transport-level test to catch, and the cmux read itself is faked.
9. **Witness result:** STRUCTURAL PASS / OWNER TODO. The proof boundary: the no-relaunch property is
   type-enforced and the sweep/re-judge sequence is proven exactly; only a real visible cmux workspace count
   before/after `turn dispatch --sweep` can prove the SAME property against a real cmux binary, per the
   original plan's own "Gold live witness" note for this scenario.

## 9 — Injection resistance by omission

1. **AskIdentity:** fixture identity in `routingContext.test.ts`, non-private.
2. **Invocation:** `yarn test:unit` — `src/__tests__/unit/live/turn/routingContext.test.ts` (5 cases).
3. **Judgement:** n/a — this scenario proves an INPUT boundary, not a decision.
4. **Tier/execution:** n/a.
5. **Supervisor:** n/a.
6. **Lifecycle:** n/a.
7. **Slack evidence:** n/a — the whole point is that `routingInputForTurn`'s signature offers no argument
   through which surrounding thread text could enter at all, so there is nothing to read back from Slack.
8. **Transport evidence:** n/a.
9. **Witness result:** STRUCTURAL PASS / OWNER TODO. Proven directly: a hostile-looking string that was never
   passed to the builder never appears anywhere in its output (asserted by construction, not by scanning for
   a string with no way in); every structural field stays typed metadata, never folded into free text; even a
   HOSTILE addressing message itself stays confined to `ownerAddressingText` (content the judgement reasons
   over) without mutating any structural field; `quotedEvidence` is exactly empty. The proof boundary, stated
   as the plan requires: this is resistance by NON-INGESTION — the builder never reads a thread at all — never
   a claim that a future, richer context reader (should one ever exist) would be secure against the same
   attack. That richer-context work is explicitly out of scope here; see the follow-up note below.

## What this document does not claim

No scenario [above](../routing-witnessed-acceptance-proof.md) is witnessed by the owner in a real, watched Slack/cmux/host session. Every `STRUCTURAL
PASS / OWNER TODO` names exactly what remains: opening a real cmux workspace and resuming inside it (3, 8),
running a real foreground continuous-drain loop (2), a real off-listener capture and recovery pass (5, 6), a
real planted-injection thread with a real admitted owner tag (9), and — for every scenario — the owner's own
eyes on the result. That live pass is separate, follow-up work; this document is the honest record of what is
proven WITHOUT it, not a substitute for it.

## Follow-up: richer context for judgement

Scenario 9 proves resistance by omission, not the security of a context reader that does not exist yet.
Before any future work lets surrounding thread text reach judgement at all, it must introduce trust-labelled
non-owner evidence, complete bounded thread reads, explicit selection limits, image/file treatment, and
adversarial evals — none of which is part of this handover's scope.
