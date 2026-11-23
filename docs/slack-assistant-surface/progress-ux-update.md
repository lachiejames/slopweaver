# UPDATE — the progress-UX drift resolved, read directly against `main`

Part of [The assistant/agent surface: what the irreversible toggle actually buys](../slack-assistant-surface.md).

The question this answers: can the bot's replies be relied on to carry a good Slack UI with near-realtime progress
updates while a task executes, given that Slack agent API streaming primitives and a hand-updated checklist were both
debated, and both sometimes appear?

**The owner does see both, and it is real, current code — not a misremembering, and not the streaming-vs-checklist
question either (that one is closed, see [§ 4 above](native-chrome-and-methods.md#4-the-native-task-chrome-is-block-kit-and-it-is-available-right-now) and `docs/security.md`'s Codex-boundary-adjacent history;
nothing here reopens it).** Three prior documents each described a different mechanism and none of them
matches `main` today: this section replaces all three with what the code actually does, read function-by-
function rather than assumed from an earlier recon. It corrects this doc's own **"Decomposition"** section
[below](multi-human-and-decomposition.md#decomposition), whose "the checklist uses neither `assistant.threads.setStatus` nor the streaming methods nor a `task_card`
block" line was true of an earlier build and is not true now.

## The plain answer: it depends on the tier and on elapsed time, not on chance

A real Slack thread-watcher on a long turn sees **both mechanisms, but covering two different, non-
overlapping spans** — and which pattern dominates depends on whether the turn was dispatched to a fresh
visible session:

| Turn shape                                                                     | The checklist message                                                                                                                                                       | The ambient `setStatus` indicator                                                                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **`fresh-visible-session`** (dispatched to a cmux workspace)                   | **Genuinely live for the whole span.** A separate sweep re-reads the workspace's screen and edits the SAME message in place, repeatedly, for as long as the turn runs.      | Set once at capture, silently expires after Slack's own 2-minute timeout, and is **never re-asserted again** until the turn's very last second. |
| **`inline` / `read-only-subagent`** (answered by the capturing session itself) | Posted at capture; `turn dispatch` tries to move it on once, then it moves only when the session runs `turn status` — nothing else touches it until the answer replaces it. | Same one-shot set-then-expire, with the same silent gap once past 2 minutes.                                                                    |

**Neither tier gets a continuously-live ambient indicator.** The only code that re-asserts `setStatus` on a
timer is `statusLifecycle`'s `beginStatus` (`src/live/turn/poster.ts:298-340`, `ASSISTANT_STATUS_REASSERT_MS`
= 100s, `poster.ts:99`), and it is reachable through exactly one path: `runQueryUnderStatus`
(`src/live/turn/run.ts:478-530`) inside `runTurn`, called only by `answerMention`
(`src/live/turn/poster.ts:1018`), called only from `slopweaver turn answer`
(`src/cli/commands/turn/run.ts:734` — confirmed the SOLE call site by grep across `src/`). By the time `turn
answer` runs, "the thinking already happened upstairs" (that file's own header, line 29) — its query
(`sessionTurnQuery`, `turn/run.ts:145-151`) fires exactly one synchronous `onPhase` and returns, so the
reassert timer this mechanism exists for never gets to tick even once in practice. What actually happens at
the end of every turn, every tier, is a fast flash: the checklist advances one more step, the status flickers
on then off within the same call, then the real answer posts and the checklist is deleted
(`deliverAnswer`, `run.ts:780-842`).

## Where the checklist's real liveness comes from — and why it is fresh-visible-session only

1. **Capture** (`src/live/listen/capture.ts`'s `withCapturedChecklist`/`setCapturedStatus`, wired live via
   `src/cli/commands/listen/liveCapture.ts`'s `liveCapturedChecklistDeps`) posts the working checklist AND the
   one-shot status indicator, both within seconds of the `:eyes:` reaction, for every tier alike — this is the
   fix for the "looks dead for two minutes" gap and it is genuinely instant. The status call here
   (`liveCapture.ts:86-95`) is a raw, single `transport.setAssistantStatus`, **not** routed through
   `statusLifecycle`'s reassert loop — it has no re-assertion of its own.
2. **`turn dispatch`** (`src/live/turn/tier.ts#executeTier`, `src/cli/commands/turn/dispatchInitial.ts`) checks
   the card capture posted — posting one if none is on record or Slack reports it gone, and refusing the
   dispatch if that post fails — and tries
   to advance it to the dispatched frame (`src/cli/commands/turn/ensureCard.ts`), for every responding tier.
   Beyond that it touches no Slack chrome: the `fresh-visible-session` arm opens a cmux workspace and returns;
   `inline`/`read-only-subagent` print instructions back to the same session.
3. **The sweep** — `slopweaver turn dispatch --sweep`, run "at the START of this loop, on every IDLE tick of
   the listener output" per `skills/loop/reference/reviewer.md`'s "A `fresh-visible-session` turn posts differently",
   and on every supervisor tick as its `turn-dispatch-sweep` reading — is the only thing OUTSIDE the worker that advances a `fresh-visible-session`
   turn's checklist mid-flight. `sweepOne` (`turn/dispatchSweep.ts`) reads the dispatched workspace's live
   screen, and when it finds a running detail worth showing, `pushLiveChecklistDetail`
   (`turn/sweepCard.ts`) calls `liveChecklistAdvancer().advanceWorking()` (`live/turn/posterIndicators.ts`) —
   the SAME `chat.update` the checklist quartet uses, but driven from outside `runTurn` entirely, on whatever
   cadence the supervising loop happens to poll at. `sweepOne`'s own guard
   (`dispatched.tier === "fresh-visible-session" ? … : undefined`, `turn/dispatchSweep.ts`) is why `inline` and
   `read-only-subagent` turns never get this treatment: nothing sweeps them, because nothing dispatched them
   anywhere a screen could be read from.

**The corollary worth stating because it is easy to miss:** an `inline` turn whose own investigation (inside
the visible session, before it ever calls `turn answer`) runs past roughly two minutes without a `turn status`
shows **nothing moving** in Slack for the remainder — no checklist edit, no live indicator — until the answer
lands. This is
not a bug filed anywhere and this section is not asking anyone to fix it; it is the missing half of "why do I
see both sometimes," stated so the next person who notices the gap does not have to re-derive it.

**Baseline check, run directly rather than assumed:** `grep -rn "answerMention(" src` returns exactly one
non-test call site (`src/cli/commands/turn/postAnswer.ts`); `grep -rn "postWorking(" src` returns the capture
path (`src/cli/commands/listen/liveCapture.ts`) and `beginTurn`'s own fallback for a checklist-less
hand-driven brief (`src/live/turn/turnBegin.ts`, two calls). `turn dispatch`'s card gate posts a missing card
through capture's own `postChecklist` wiring (`src/cli/commands/turn/liveCardWiring.ts`), not through
`postWorking`. Re-run both against a later `main` before trusting this
table again — the whole point of dating it is that it can go stale the same way its three predecessors did.

A recon, not a build. It answers six questions about Slack's agent surface with observed API responses where
one exists, and says "unverified" where only a documentation sentence does — then sets out a decomposition
into pieces that do not overlap, so they can be fanned out.

It supersedes nothing in [`slack-agent-surface.md`](../slack-agent-surface.md), which measured the RENDERER
and remains correct. That note answered a question about **methods**. The owner is asking about the
**badge and the native chrome**, which is a different question, and this is the answer to that one.
