# 1 — Inline, through the real host loop

Part of [Routing witnessed-acceptance proof](../routing-witnessed-acceptance-proof.md).

1. **AskIdentity:** channel `[bot-DM]`; `messageTs` `…780849`; `threadTs` `…780849` (equal — a top-level ask,
   never a reply).
2. **Invocation:** `yarn test:integration` (replay) / `POLLY_MODE=record … yarn test:integration` (record) —
   `src/__tests__/integration/turnInlineCompletion.test.ts`, cassette
   `turn-inline-completion-integration-real-Slack-via-Polly-cassette_2889515188`. Recorded against
   the live Slack API; replayed offline thereafter. Final-head anchor: not yet set (see header).
3. **Judgement:** `{"schemaVersion":1,"response":"respond","tier":"inline","confidence":"high","needs":[],"rationale":"context and judgement alone answer this"}` — the test drives `answerMention` directly with `tier: "inline"`, the exact production wiring `cli/commands/turn/run.ts`'s `postAnswer` uses.
4. **Tier/execution:** `single-turn` mode, `inline` tier, host `claude-code` (both scripted, matching the
   production shape). `inline` is unconditionally admissible in every execution mode.
5. **Supervisor:** `provenance.modelId: "integration-test"` (scripted); no fresh cmux workspace opens for this
   tier, so there is no separate session/surface to attest.
6. **Lifecycle:** the completion's `askIdentity` is asserted equal to the mention's own identity;
   `lifecycleEventForCompletion` projects it to `answered`; appended to a fresh ask-lifecycle log and folded
   back — the fold's last event is `answered`, carrying the SAME `answerTs` the completion reported.
7. **Slack evidence:** addressed `…281.846369`; static checklist `…283.426179`; answer `…285.329309`. Read back
   independently via `fetchCompleteSlackThread`/`parseAssistantAnswerMetadata` (the SAME path
   `recoverSlackAsks`'s already-answered check depends on): the answer's metadata is `event_type:
slopweaver_assistant_answer_v2`, `renderer: slack-assistant-answer-v2`, `askIdentity.quality: exact`,
   `askIdentity.messageTs`/`threadTs` equal to the mention's own — asserted exactly, not merely present. The
   working checklist message (`…283.426179`) is confirmed GONE (`thread_not_found` on read-back) after the
   turn completes.
8. **Transport evidence** (cassette entries, in order): `chat.postMessage` (the scripted ask) →
   `assistant.threads.setTitle` → `chat.postMessage` (metadata-bearing checklist opens) →
   `assistant.threads.setStatus` → `chat.update` (the same checklist advances with metadata intact) →
   `chat.postMessage` (the real answer) → `reactions.remove` → `reactions.add` →
   `chat.delete` (checklist removed) → `assistant.threads.setStatus` →
   `conversations.history` → `conversations.replies` ×2 (this proof's own independent read-back).
9. **Witness result:** STRUCTURAL PASS / OWNER TODO. The proof boundary: everything above is a REAL exchange
   with the Slack API, captured once and replayed deterministically thereafter — not a mock, not a fake
   transport. What it does not establish is that the owner watched this happen in a real Slack client; that
   is a live-witness claim this document does not make.

## 2 — Continuous-loop refusal and re-judgement

1. **AskIdentity:** two cases, each with its own fixture identity (`channel` `C1`; `messageTs`/`threadTs`
   `…000100`/equal, a top-level ask) — see the test file for exact fixtures; not private.
2. **Invocation:** `yarn test:unit` —
   `src/__tests__/unit/cli/commands/turn/dispatch/tiers.test.ts` describe block `turn dispatch — continuous-drain
refuses read-only-subagent, then re-judges`.
3. **Judgement:** first call: `{"response":"respond","tier":"read-only-subagent","needs":[{"capabilityId":"fleet-status",...}],...}` under `execution.mode: "continuous-drain"`. Second call, same identity: `{"response":"respond","tier":"inline",...}`.
4. **Tier/execution:** `validateTierForExecutionContext` refuses `read-only-subagent` under `continuous-drain`
   BEFORE `executeTier` ever runs — no native subagent starts, no tier rewrite. `inline` is unconditionally
   admissible, so the second call dispatches normally.
5. **Supervisor:** the SAME visible session drives both calls in the test, matching the real design: one
   supervisor records a first judgement, sees the refusal, and records a second one for the same ask.
6. **Lifecycle:** after the first (refused) call, the ask-lifecycle log carries NO `dispatched` event at all
   — asserted directly. After the second call, the fold's last event is `dispatched(inline)` for the exact
   same `(channel, messageTs)`.
7. **Slack evidence:** n/a — neither call in this scenario ever touches Slack; `turn dispatch` refuses or
   dispatches purely from the brief/decision files and the local ask-lifecycle log.
8. **Transport evidence:** none — this is the point. The refusal happens before any cmux/subagent/Slack call.
9. **Witness result:** STRUCTURAL PASS / OWNER TODO. The proof boundary: this proves the CODE refuses and
   re-dispatches correctly; it cannot prove a real Codex/Claude continuous-drain loop actually judges
   `read-only-subagent` for a genuine drain-mode ask and then re-judges inline live, which needs a real
   foreground loop run per `skills/loop/SKILL.md`.

## 3 — Fresh cmux session with durable thread handoff

1. **AskIdentity:** fixture identities across several test files, each with realistic (7+ digit) Slack-shaped
   timestamps so the identity-bound permalink check in `parseFreshDispatchRecord` has something real to
   parse; none are private.
2. **Invocation:** `yarn test:unit` — `src/__tests__/unit/live/turn/dispatch.test.ts` (schema V2 + identity
   binding, 8 cases), `src/__tests__/unit/live/slack/permalink.test.ts` (`slackAskPermalink`, 4 cases),
   `src/__tests__/unit/live/turn/dispatchStore.test.ts` (store round-trip + version diagnostics, 12 cases),
   `src/__tests__/unit/live/turn/freshSession.test.ts` (boot/pickup-delivery split, 5 cases),
   `src/__tests__/unit/cmux/spawn/` (unchanged, still green after the split, 13 cases).
3. **Judgement:** `{"response":"respond","tier":"fresh-visible-session",...}` fixtures throughout.
4. **Tier/execution:** the durable `FreshDispatchRecord` (schema V2) carries `askPermalink`, bound at the
   parse boundary to equal the record's own `channel`/`messageTs`/`threadTs` exactly — a hand-edited or
   corrupted permalink is refused, not silently trusted. Cross-workspace token mismatch (bot vs. read token)
   is refused before a permalink is ever built (`sameSlackWorkspace`, 4 cases). The record is written BEFORE
   the pickup command is delivered (`bootCmuxWorkspace`/`deliverPickupCommand` split), closing the race where
   a fast fresh agent could act on a verified prompt before its own dispatch record exists.
5. **Supervisor:** `session.host`/`surfaceRef`/`workspaceRef` are carried on the record; `turn resume`'s LOAD
   mode prints `ASK PERMALINK: <link>` and the exact `slack read-thread <link> --json` instruction, verified
   in `cli/commands/turn/resume/loadLines.test.ts`.
6. **Lifecycle:** `dispatched(fresh-visible-session)` → (real workspace boot, not exercised here) →
   `answered`/`failed`/`lease-expired`, per the existing (unchanged) tier semantics.
7. **Slack evidence:** n/a for this scenario's own unit coverage — the permalink is BUILT, never a pre-fetched
   thread; the fresh session reads the live thread itself once it boots, via the unchanged `slack read-thread`
   path (already proven against real Slack in this repo's existing integration suite).
8. **Transport evidence:** none in this scenario's own tests — `productionSpawnDeps()`/`readScreen` are
   hardwired, not injected, deliberately (see `cli/commands/turn/dispatch/sweepAndPoll.test.ts`'s own header) and proven only by a real
   watched run.
9. **Witness result:** STRUCTURAL PASS / OWNER TODO. The proof boundary: every identity-binding, workspace-
   verification, schema-migration, and boot/delivery-ordering property is proven directly; opening a REAL
   cmux workspace and resuming inside it is not — that is exactly the class of proof `AGENTS.md`'s rule 2
   requires stay in a visible, owner-watched session.

## 4 — Deliberate no-response

1. **AskIdentity:** fixture identities in `poster/fixtures.ts`/`dispatch/noResponse.test.ts`, realistic and non-private.
2. **Invocation:** `yarn test:unit` — `src/__tests__/unit/live/turn/poster/deleteCapturedChecklist.test.ts` describe block
   `deleteCapturedChecklist — the scenario-4 structural cleanup` (2 cases);
   `src/__tests__/unit/cli/commands/turn/dispatch/noResponse.test.ts` describe block `turn dispatch — no-response`.
3. **Judgement:** `{"response":"no-response","confidence":"high","rationale":"..."}`.
4. **Tier/execution:** n/a — `no-response` never selects a tier.
5. **Supervisor:** n/a.
6. **Lifecycle:** `triage-cleanup-intended` (non-terminal, carrying `checklistDelete` when a capture checklist
   exists) is appended FIRST; the checklist is deleted (or confirmed absent); only THEN is the genuinely
   terminal `triaged-no-response` appended. A missing bot token, or a delete that cannot be confirmed, leaves
   the lifecycle at the non-terminal state rather than falsely terminal — asserted directly. The delete target
   is always the lifecycle's own recorded `checklist-posted` ref when one exists (a Codex review finding, fixed:
   a caller-supplied `--turn-id`/`--working-ts` disagreeing with what was actually posted could otherwise be
   "confirmed deleted" against the wrong message while the real checklist stayed stuck). One precondition
   remains open rather than silently closed: an ask whose `checklist-posted` was never durably recorded at
   all (the same accepted crash-window gap `../../src/live/ask/lifecycle.ts`'s `ChecklistPostedEvent` doc already
   names) and whose brief carries an explicit but wrong flag pair is still unverifiable by this process alone
   — see the doc comment on `handleNoResponse` in `src/cli/commands/turn/dispatchAdmit.ts`.
7. **Slack evidence:** `deleteCapturedChecklist` reuses `deleteWorkingImpl` (the SAME direct deletion
   the answer path uses), routed through `throughDoor`, and is asserted to call the transport with the exact
   `askIdentity`/`started` identity it was given.
8. **Transport evidence:** the delete-succeeds happy path is deliberately NOT unit-tested — `handleNoResponse`
   hardwires a real `SlackWriteTransport`, matching this exact file's own documented precedent for the
   fresh-session tier; coverage is scoped to the network-free missing-token-refusal branch.
9. **Witness result:** PASS. The structural half (record intent, delete the checklist) was proven here
   first; the Slack-visible follow-up that this row carried as an OWNER TODO is now settled and wired.
   The owner chose delete-and-react, with a THIRD reaction rather than a re-use of the existing two:
   `triaged` earns the acknowledged ending (`:ack:` by default, `profile.json`
   `slackBot.acknowledgedReaction`), because the tick overstates an ask nothing was answered for and the
   warning reads as an error the asker should act on. `handleNoResponse` now calls
   `settleTriagedAskIndicators` through the same `finaliseIndicators` seam every other terminal uses, AFTER
   the terminal event is appended — so a reaction Slack declines is reported and the judgement still
   stands. Measured twice, across two sessions and two asks, as a capture `:eyes:` left
   standing over a correctly handled ask; regression cases in
   `src/__tests__/unit/live/turn/convergesLifecycleReact/triagedNoReplyOwed.test.ts` describe block
   `convergesLifecycleReact — triaged, no reply owed`. Its contrast is a reply that IS owed by a person:
   `{"response":"for-a-human",...}` rides the same path through `handover-cleanup-intended` to the terminal
   `left-for-a-human` and settles to `:for-a-human:` (`slackBot.forAHumanReaction`), never `:ack:` — the
   owner's fourth ending; `leftForAHuman.test.ts` beside it, describe block
   `convergesLifecycleReact — judged, left for a person to answer`.
