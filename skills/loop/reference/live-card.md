# Keeping the live card alive

The in-thread progress card, and the two mechanisms that keep it honest. Read this before changing anything
about how a turn reports progress.

## The complaint this exists to answer

A card sat unchanged while a worker investigated for 45 minutes, and to humans it looks broken. A card should
say what commands are currently running and what data there is so far, the way most AI agents let you watch
what they are doing.

Measured across three dogfood turns, the card was edited six or seven times over turns of 22 to 50
minutes, with worst freezes of 7m50s, 11m35s and 16m37s. Two independent defects produced that:

- **Nothing forced a cadence.** The verb's own help said "call it repeatedly at natural checkpoints", so the
  card moved at narrative boundaries — and the long silences are exactly the stretches with no narrative
  boundary in them (waiting on a reviewer, rewriting a refused answer).
- **The card had nowhere to put a finding.** It was two steps plus ONE 120-character detail, replaced on
  every write. Even a perfect cadence would have given the reader one rotating sentence.

## 0 · The card is already on the real shape before you touch it

A capture-time card wears the PRE-ROUTING placeholder — `✓ Read the question` / `◦ Work out how to answer` —
because routing has not run when it is posted. `src/live/turn/turnBegin.ts` corrects that, and it runs only
inside `turn run`, the INLINE path, so for a year nothing on the dispatch path touched the card at all.
MEASURED on `C0SYN000006`/`1789952379.135579`: the public card sat on `Work out how to answer`
for two hours and thirty-eight minutes, waiting for a `turn status` its worker never ran.

`src/cli/commands/turn/ensureCard.ts` now advances the card it proves, on all four of its branches, to the
same per-stage frame `turn status` writes (`dispatchedCardFrame`). Two consequences for a worker: your first
`turn status` APPENDS a stage rather than changing the card's genre, and a card still showing the placeholder
mid-turn is a real defect worth reporting rather than the normal starting state. A refused advance is printed
on the dispatch's own line and never stops the dispatch.

**And it is the only shape there is.** The `slack progress` family that drew a second, competing card was
deleted; nothing else posts or edits a turn's card, so a turn that wants a
card reaches for `turn status` and `turn watch` and for nothing else.

**One tag, one card, even across a sub-ask.** A question the loop dispatches from inside another ask's turn
(the compound "add X, then answer their question", [edge-cases.md](edge-cases.md)) RIDES that ask's card via
`turn brief --rides`, rather than posting a second one — measured, when it did not. Two asks then
share one card: the newest holder writes it and the last to finish removes it (`src/live/ask/sharedCard.ts`).
A dispatch whose known card Slack reports gone (`message_not_found` on the advance) posts a fresh one and says so.
Every frame names the people it tags — `@Ari`, never `@(U0SYN000003)` — off member bronze, through
`src/live/turn/cardNames.ts`; an id nobody can name stays an id.

## 1 · `turn status` declares a PLAN, then files a STAGE against its step

The card draws the planning loop ([its shape and bounds](live-card-plan.md)). Declare the plan once you know
the shape of the work — a new `--plan` is a RE-PLAN, and the meter says so — then file each finding against its step:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn status --brief <the brief path> --plan $'Read the thread\nCheck the PRs\nAnswer'
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn status --brief <the brief path> --status "8 of 10 bot PRs merged" --step 2
```

Write what you LEARNED, not what you are about to do: `thread read — 47 msgs, 12 PRs named`, never `reading
the thread`. The first answers "what have you got"; the second is noise once it is done.

**Write for the reader, never for yourself.** A card once read `answer
validated, sending it for review by a session i did not brief` — internal mechanics nobody in the channel
has context for. `an independent reviewer` is what this codebase calls that session in its own docs and
prompts; a reader just needs `answer validated, sending for independent review`. Say what happened and why
it matters to someone watching, never how the plumbing works.

## 2 · `turn watch` reruns the card on a clock

Start it ONCE, in the background, straight after `turn resume`. On a DISPATCHED turn this is the WORKER's own
step 0a — `turn resume` prints the exact line with this brief and home already on it, ahead of the stages. An
`inline` or `read-only-subagent` turn gets it FIRST from `turn dispatch`: an inline "yo" once ran 50
minutes, two review rounds, with nothing writing its card (`fixtures/replay/inline-turn-silent-card-19sep`).

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn watch --brief <the brief path> &
```

- **One ticker per card, enforced** (`src/cli/commands/turn/watchLock.ts`, measured there). A second looping
  start from this session, detective leaves included, exits 0 at once. `--once` claims nothing.
- **No model runs in it.** It reads the turn's progress log and this session's own command log, renders, and
  calls `chat.update`. Doctrine rule 2 bans a headless MODEL; this starts none.
- **It is NOT a child of this session.** MEASURED on darwin,
  two tool calls apart: `tail -f /dev/null &` reported pid 11604 with ppid 11578 — its tool-call shell — and by
  the next call pid 11604 had **ppid 1** while 11578 no longer existed. No `nohup`, no `setsid`, no `disown`
  anywhere. An agent tool call gets a ONE-SHOT shell, so it exits the instant the call returns and every
  background job it holds reparents immediately.
- **Still a bare `&`, and still never `nohup`/`setsid`/`disown`.** Those three buy nothing here — the shape is
  already detached — and typing one only makes the next reader believe in a protection that is not there.
- **So the ticker reaps ITSELF.** Until this landed, `--max-seconds` was the only bound on an orphan and its
  default is the two-hour dispatch lease, so a worker that died WITHOUT answering left a process telling the
  thread its turn was alive for the rest of it. The loop also stops when it is orphaned **and** its
  worker's own transcript has stood still past the bound in `src/cli/commands/turn/tickerOwner.ts`, which is
  derived from the longest single wait this contract prescribes (`turn review --poll --wait`) rather than
  picked. Every condition is required: a turn **blocked on the owner** is idle by design: never reaped, never rewritten, a
  ticker some future host genuinely parents is bounded by that host, and an unreadable transcript — a Codex
  worker's normal state — is not a death observed.
  `docs/listener-supervision/failure-and-evidence.md` reached this answer for the LISTENER off the same
  measurement: what such a process needs is not immortality but for its death to be **noticed**, a
  death-watch rather than a better hosting trick.
- **It stops on `answered`, and deliberately NOT on `failed`.** A refused send is when you keep working and
  the reader most needs the card — see `src/cli/commands/turn/watch.ts`'s header for the measured turn.
- `--once` does a single tick and exits, which is what a test or a probe runs.

**The floor under it, when a worker skips it anyway.** `--sweep`'s own courtesy push now renders the same
`now:` line from the same source — the worker's own transcript — because `turn resume` and `turn status` both
record which visible session the worker IS (`src/live/turn/workerSessionStore.ts`). So a card moves with real
content on every sweep pass whether or not a ticker runs. It does **not** retire the ticker: measured on ask
`C0SYN000009/1789344513.735589`, sweep pushes landed every 6.3–6.6 minutes, which is past the
five-minute bound §3 judges a card by. The ticker is the cadence and the sweep is the floor.

**A ticker or sweep `now:` line leads with how long the reader has waited**, from the ask's own ts — `asked 45m
ago, nothing new for 31m` once the worker is quiet past the reap bound, never `still working` — and **while a
review round is open it is the round**: `now: still working, 57m · independent review, round 2 · open 9m`.

## 3 · The staleness probe

`turn dispatch --sweep` prints `card-stale:` for a card that is **right now** five minutes past its last
write while its worker is alive. That line is a defect report, not noise.

Five minutes is measured, not picked: over three real turns a five-minute bound fires on all three
and a ten-minute bound on only two. `src/__tests__/unit/live/turn/progressLog.test.ts` asserts the exact gaps
off that timeline, so the probe is falsifiable against real history.

**Read the whole line — it separates the present from the past.** The minutes and the `since` describe the
gap **still open**, and the turn's longest gap rides behind a `;` in the past tense when it is worse. An
alarm announcing a historical gap in the present tense fires for the rest of a turn after one early stall:
a card writing every twenty seconds was once reported "not changed for 5.1m" off a gap closed 48
minutes earlier.

```
card-stale: <channel>/1788324902.031449 — the card has not changed for 6.2m (since …T05:21:53.000Z)
while its worker is still working; its worst stall this turn was 9.2m (since …T04:55:02.676Z), already closed
```

`openProgressGap` and `worstProgressGap` in `src/live/turn/progressLog.ts` are the two readings;
`progressGapsExceeding` is the whole HISTORY and is for an after-the-fact audit, never for a live alarm.

**It measures since the card CHANGED, never since it was last written** (`changingWrites`, same file). A
writer re-sending the detail the card already carried leaves a card frozen in every sense a person in the
thread can perceive, while resetting a write-counting clock — which is exactly what four identical `─` pushes
did once, and what a ticker against a Codex worker (no transcript, so a constant
`now: still working — 0 tool calls so far`) would do forever — so the turn clock, which moves every minute
regardless, is compared stripped.

**And it names the CAUSE when the cause is a missing ticker.** The line carries `; no \`turn watch\` process
is running for this dispatch, which is why — send the worker: <the exact command>` whenever one reading of the
process table finds no ticker for this dispatch's own brief. A table nobody could read prints nothing: that
is not evidence either way.

## 4 · A budget warn shows on the card, and its note does not

Once the loop's sweep raises a budget warn on a dispatch
([sweep.md](sweep.md#the-budget-warn--you-are-the-witness-on-this-pass-and-nobody-else-is)), the running
step's detail reads `warn raised — …`, so the reader sees the same clock the bot does. Every running-card
writer — `turn status`, `turn watch` (re-read each tick), the sweep and `turn unblock` — reads the same `warn`
rows off the progress log, so no two writers alternate a warned and an unwarned card. The loop's note is for
the worker and never renders.

## 5 · Retracting the card of an ask ANOTHER turn already answered

Two asks in one thread, and your answer to the first covers the second. The second still carries its own
working card, so leaving it standing is noise — and dispatching it purely to close itself puts a FOURTH bot
message into a finished thread. MEASURED on `C0SYN000012`: ask `1787540579.950269` was satisfied
by another ask's turn, and posted that fourth card 52 minutes later.

```bash
slopweaver turn satisfied --channel <id> --message-ts <ts> --answered-by-ts <ts> --reason "<why>"
```

It retracts every card this ask published, settles its reaction to COMPLETION, records the pointer to the
answering message, and says nothing in the thread. Three things are the rule rather than a note:

- **It is not `turn ignore`** ([edge-cases.md](edge-cases.md#a-permanently-ignored-ask-never-reaches-you-at-all)).
  Ignore says nothing was answered, settles to STOPPED and writes a standing registry entry. This one says it
  WAS answered, by a message you name, and suppresses nothing.
- **`--answered-by-ts` is CHECKED, not trusted.** The ask's own message, or a card the ask itself posted, is
  refused before any Slack call — a half-ticked working checklist is not an answer.
- **A card that will not delete means NOTHING is written.** The verb exits 1 and the ask stays non-terminal, so
  re-running it once the card is gone is the whole recovery: a terminal appended over a standing card can never
  be revisited.

Nothing derives "this ask is satisfied" on its own and nothing should — you decide it, you name the answer, you
say why. A [hunt's findings](../../automation/reference/organisation-hunt.md) settle it too. `--help` has more.

## Why the log exists at all

`turn answer` DELETES the card, and Slack exposes no edit history even before that — so once a turn answers
there is no provider-side record of what its card ever said. Every write is recorded in the turn's own
progress log (`$SLOPWEAVER_HOME/live/slack/progress/<channel>-<messageTs>.jsonl`) as it happens. That is what
makes the probe possible, and what lets anyone reconstruct afterwards what a reader actually saw.

## Both halves, or neither works

`--sweep`'s screen-scrape is the DISPATCHER's view and stops the instant a `dispatch-failed` or a `failed`
ends the dispatch. That once left a card reading "this turn was abandoned" for 40 minutes while the
worker worked, and another frozen for 36. A dispatched worker owns its own card, and needs both the
stages and the ticker.
