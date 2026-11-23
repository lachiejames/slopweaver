# Routing witnessed-acceptance proof

**Grade:** silver — a real seam exercised locally with captured evidence (one scenario against real Slack,
recorded and replayed via a committed Polly cassette), plus exhaustive pure/CLI unit coverage for every other
scenario. Not yet gold: gold requires the owner's own visible-host witness for the tiers that open a real
cmux workspace or drive the continuous-drain loop end to end, which this document explicitly defers rather
than fabricates — see "What this document does not claim" [below](./routing-witnessed-acceptance-proof/scenarios-5-to-9-and-limits.md#what-this-document-does-not-claim).

**Branch:** `routing-witnessed-acceptance`. **Proof-commit contract:** the PR body's
`proof-commit: <sha>` is the authoritative anchor, per the gold contract in [the pull-requests reference](../skills/github/reference/pull-requests.md). Any later push
invalidates a prior anchor; re-verify before citing one.

**Test environment:** `yarn test:unit` (full suite, offline) for every pure/CLI-level claim below;
`yarn test:integration` (Polly replay, offline, deterministic) for the one live-recorded scenario.
`yarn lint`/`yarn typecheck` both clean at time of writing.

**Redaction policy:** no raw channel/user/workspace id, message prose, token, local home path, or
unsanitized screenshot appears below. Slack message timestamps are NOT treated as private identifiers here —
they are already committed in cleartext inside the redacted, hygiene-scanned cassette this document cites,
and keeping them lets one scenario's identity be cross-checked against the cassette directly. A bracketed
placeholder (`[bot-DM]`, `[owner]`) stands in for anything that is.

**Cleanup status:** the one real Slack write this proof performed (scenario 1/7) left two messages standing
in the bot's own DM with the owner — the scripted "ask" parent and the real answer it produced — matching
this repository's own established cassette-recording convention (see `slackAssistantStreamWrite.test.ts`'s
header): a real answer is the product, not litter, so it is not cleaned up. The working checklist it opened
was deleted by the turn itself, and that deletion is independently verified [below](./routing-witnessed-acceptance-proof/scenarios-1-to-4.md) rather than assumed.

## Summary matrix

| #   | Scenario                               | Automated evidence                                                                                                                                                                      | Live witness | Result                       | Limitation / TODO                                                                              |
| --- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Inline, real host loop                 | `turnInlineCompletion.test.ts` — real Slack, Polly cassette                                                                                                                             | none yet     | STRUCTURAL PASS / OWNER TODO | Polly transport proof, not a visible-host-watched run                                          |
| 2   | Continuous-loop refusal + re-judgement | `dispatch/tiers.test.ts` — `turn dispatch — continuous-drain refuses read-only-subagent, then re-judges` (2 cases)                                                                      | none yet     | STRUCTURAL PASS / OWNER TODO | Needs a real foreground Codex/Claude loop run                                                  |
| 3   | Fresh cmux session, durable handoff    | `dispatch.test.ts` (live/turn), `dispatch/sweepAndPoll.test.ts` (CLI), `permalink.test.ts`, `dispatchStore.test.ts`                                                                     | none yet     | STRUCTURAL PASS / OWNER TODO | Needs a real cmux workspace + resumed session                                                  |
| 4   | Deliberate no-response                 | `poster/deleteCapturedChecklist.test.ts` — `deleteCapturedChecklist`; `dispatch/noResponse.test.ts` — no-response cases; `convergesLifecycleReact/triagedNoReplyOwed.test.ts` — triaged | none yet     | PASS                         | Slack-visible follow-up settled: the acknowledged reaction, wired through `finaliseIndicators` |
| 5   | Captured but unanswered recovery       | `recover/classifyCandidate.test.ts` — `started` propagation; `recover/classifyLifecycle.test.ts` — `already-resolved` cases                                                             | none yet     | STRUCTURAL PASS / OWNER TODO | Needs a real off-listener capture + recovery pass                                              |
| 6   | Off-period recovery                    | `recover/breadthIsNotPermission.test.ts`, `recover/threadReplyDiscovery.test.ts` (live), `recover.test.ts` (CLI), `pagination.test.ts` — `fetchCompleteSlackHistory`                    | none yet     | STRUCTURAL PASS / OWNER TODO | Needs a real tag sent while no listener ran                                                    |
| 7   | Static checklist after redesign        | `turnInlineCompletion.test.ts` (transport half); `completionLifecycle.test.ts` (projection half)                                                                                        | none yet     | STRUCTURAL PASS / OWNER TODO | The owner visibly watching the checklist advance is not established by a cassette              |
| 8   | Expired fresh-session lease            | `dispatch/sweepAndPoll.test.ts` — `turn dispatch — sweepDispatchedAsks surfaces an expired lease…` (3 cases)                                                                            | none yet     | STRUCTURAL PASS / OWNER TODO | Needs a real cmux workspace count before/after `--sweep`                                       |
| 9   | Injection resistance by omission       | `routingContext.test.ts` (5 cases)                                                                                                                                                      | none yet     | STRUCTURAL PASS / OWNER TODO | Needs a real planted-injection thread + a real admitted owner tag                              |

Every row is `STRUCTURAL PASS / OWNER TODO`: the mechanism is proven mechanically (real Slack for scenario
1/7, exhaustive plain-fake unit coverage for the rest), and what remains for every scenario is the SAME
category of thing — the owner's own eyes on a live run — never a missing code path. None of the nine is a
`FAIL`.

- [1 — Inline, through the real host loop](./routing-witnessed-acceptance-proof/scenarios-1-to-4.md)
  - [2 — Continuous-loop refusal and re-judgement](./routing-witnessed-acceptance-proof/scenarios-1-to-4.md#2--continuous-loop-refusal-and-re-judgement)
  - [3 — Fresh cmux session with durable thread handoff](./routing-witnessed-acceptance-proof/scenarios-1-to-4.md#3--fresh-cmux-session-with-durable-thread-handoff)
  - [4 — Deliberate no-response](./routing-witnessed-acceptance-proof/scenarios-1-to-4.md#4--deliberate-no-response)
- [5 — Captured but unanswered recovery](./routing-witnessed-acceptance-proof/scenarios-5-to-9-and-limits.md)
  - [6 — Off-period recovery](./routing-witnessed-acceptance-proof/scenarios-5-to-9-and-limits.md#6--off-period-recovery)
  - [7 — Static metadata checklist after redesign](./routing-witnessed-acceptance-proof/scenarios-5-to-9-and-limits.md#7--static-metadata-checklist-after-redesign)
  - [8 — Expired fresh-session lease](./routing-witnessed-acceptance-proof/scenarios-5-to-9-and-limits.md#8--expired-fresh-session-lease)
  - [9 — Injection resistance by omission](./routing-witnessed-acceptance-proof/scenarios-5-to-9-and-limits.md#9--injection-resistance-by-omission)
  - [What this document does not claim](./routing-witnessed-acceptance-proof/scenarios-5-to-9-and-limits.md#what-this-document-does-not-claim)
  - [Follow-up: richer context for judgement](./routing-witnessed-acceptance-proof/scenarios-5-to-9-and-limits.md#follow-up-richer-context-for-judgement)
