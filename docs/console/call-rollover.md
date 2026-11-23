# A long call rolls over in a pause, and the owner never hears it

Part of [voice context and calls](voice-context-and-calls.md).

**The owner meets the 90-minute ceiling only if its last ten minutes hold no pause**, because a call cut off at the
ceiling mid-conversation — three in one day — is what the rollover exists to end. From `rolloverFromMs` (80 minutes)
`PlanCall` (`site/lib/talkPlanCall.ts`) tells the page, once, the first time the floor is free — nobody transcribed for
`rolloverQuietMs` (4 s), no Codex turn, tool call, request, nudge, look, "on it" or resume in flight — to roll
the call over.

**A thread nearly full rolls over sooner, whatever the call's age.** Once the delegated thread's last request filled
`rolloverContextShare` (85%) of its context window (`contextRolloverDue`, `site/lib/planCallContract.ts`), the same ask
goes out at the next free floor with `CONTEXT_ROLLOVER_REASON`. Measured on one call: its thread reached
242,538 of 258,400 tokens and Codex compacted it for 118 s inside the owner's question about a held reply, 38 s before the age rollover
would have saved the owner. A fresh thread starts from the opener, not from the whole call.

**Nearer full, the context ask stops waiting for the next turn.** Once the last request filled
`rolloverContextUrgentShare` (88%), the server asks again at once, whatever its floor holds, marked `contextUrgent`
(`contextRolloverUrgent`); a thread that jumps straight past it gets that one urgent ask, never a calm one first. The
page holds an ask so marked at no calmer than **urgent** (`askStage`, `site/lib/callRollover.ts`), journalling
`entered urgent: the thread's context is nearly full`, and the mark is sticky for that call: a later or replayed ask
without it never lowers the stage, and it never carries to a successor. Context never makes the stage **last** and
names no remainder, since a compaction is a silence, not a cut that takes the owner's words. Measured on a second call: its ask was held
for nine minutes at calm, where the two next-turn holds renewed every other one (for one stretch of under a minute
only "the voice still owes its turn" held it), and the turn after a 242,428-token request
compacted silently for 61 s, then 110 s more once the owner's nudge interrupted it, until the owner hung up. Both calls measured
compacted after a request of about 242,500, and less the largest step between two requests (13,000) that is 88.8%,
so 88% is the latest share that still sees it coming. **The residue**: once a compaction has begun, nothing here
rescues the turn; a nudge interrupting it and the owed start re-running it is unchanged.

**The page judges the floor again before it acts.** Transcripts lag the owner's first words, and work can start after the
server asked, so the page holds that ask until it sees the floor free itself (`pageRolloverHold`,
`site/lib/callRolloverFloor.ts`): no delegation, tool call or Codex turn in flight, no answer the voice is part-way
through, no resume or nudge sent within
`rolloverQuietMs`, none of the owner's words transcribed within `rolloverQuietMs`, no turn of the owner's still open (keyed by turn
id), nor one ended that the voice has not spoken words since (each held at most `ROLLOVER_OWED_HOLD_MS`, the fold's
ordered state rather than a comparison of clocks; a typed turn is answered only by words `STREAM_SKEW_MS` past it,
since it arrives on the server's stream; `site/lib/voiceOwnerTurns.ts`), and neither the owner nor the voice
heard on its meters for `ROLLOVER_METER_QUIET_MS`. The transcript holds are there because the server judges its own
floor once, when it asks: one call was asked a second before the owner began a 72s turn and rolled over
on a breath inside it, leaving the successor silent on words it never heard. Then it closes the call on purpose with the reason the server gave, no cue,
the orb still live, and opens a successor minted with `talk offer --rollover`, whose opener (`rolloverOpener`,
`src/talk/mintOpener.ts`) quotes the last exchange and tells the voice to say nothing until the owner speaks. Share, mute and
what the call showed carry over (`QuietRollover`).

**The nearer the cut, the less holds it** (`rolloverUrgency`, `site/lib/callRollover.ts`). One call
was cut mid-word at its lifetime after every pause in its last eight minutes fell inside one 90-second hold or another,
renewing each other across a steady conversation. **Calm** holds as above. **Urgent**, `rolloverUrgentMs` (3 min) left,
stops waiting for the conversation's next turn — the voice's owed turn, the owner's ended turn awaiting the voice. The server
marks that window, and the last one, with elapsed timers beside the lifetime's own, and asks at each whatever its floor
holds, naming the time left (`lifetimeRemainingMs`, `null` before), measured on the elapsed clock the timers run on so a
callback a loaded loop ran late never overstates it. The server never sends a wall-clock deadline, which a stepped
clock would move while the cut stays put. The page counts the remainder down on `performance.now()` alone and reads no
wall clock, so its count can run late but never early: a civil clock stepped forward cannot fake the last stage and drop
the owner's turn's holds. Node's timers run through a Mac's sleep (libuv's `mach_continuous_time`) while `performance.now()`
stops, so a sleep leaves the page's count behind; the server's last-stage ask, timed on Node's clock, corrects it,
because a later ask keeps the sooner remainder, as it does an urgent ask that arrived late. A stream that reconnects
after an ask hears it measured again as the event ring replays it (`replayAs`, `site/lib/talkPlanEventRing.ts`), never
the remainder it carried when it went out, which would put the page's count behind by the whole outage.
**Last**, `rolloverLastMs` (30 s) left, stops waiting on the owner's turn too, keeping only the voice's own work and the meters;
an answer still pending holds only for the server's quiet after it or the voice's newest sound, which the owner's talking no
longer renews. A timed hold of the voice's work — a pending answer, an answer part-way through, a prompt — holds only
if it ends `ROLLOVER_CUT_SLACK_MS` (1 s) before the cut, the page's samples needing a moment to release on: raised with less time left than it lasts, it would hold through any pause and hand the cut a
word the voice began later. Work in flight holds only while a row of it still progresses (`progressingWork`) — a stalled row,
never closed, would pin every pause to the cut — with each Codex turn judged on its own last progress, on the orb's
own horizon (`COMPACTION_STALL_MS` while it compacts, `STALL_MS` otherwise), since a turn
waiting on a tool never shows stalled and no row says which turn a tool is for — and only while more than that quiet is left, since past it a completion
could no longer hold the floor for its answer. The meters, which are real sound, hold to the end.
Every change of stage or of what holds the ask is a `rollover` line on the call file, as is the release: a held ask is
never silent on disk.

**The lifetime stays as the backstop** for a floor that never frees. Make-before-break was weighed and refused: every
owner of a call on the page is singular, and OpenAI documents one Voice conversation at a time.

**The residue**: the successor takes the mint's seconds to come up (11.6 s measured on one reconnect), so words
the owner starts in that gap are not heard. A successor that fails to open is a drop, and reconnects as one, with the drop
cue: [call reconnect](call-reconnect.md).
