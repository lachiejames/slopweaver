# A dropped call reconnects on its own, and says how each attempt went

Part of [voice context and calls](voice-context-and-calls.md).

**A drop reconnects on its own, still seeing the owner's screen** (the owner's ruling: reconnect automatically, with visual and audio feedback). A call
that had gone live and ends on any reason the owner did not ask for plays the drop cue, and then the page keeps the owner's share, mute and transcript, reads
`reconnecting`, and mints anew after each of `RECONNECT_DELAYS_MS` (`site/lib/callReconnect.ts`) with `talk offer
--reconnect`, whose opener quotes the dropped call's last exchange (`reconnectOpener`, `src/talk/mintOpener.ts`);
live again plays the drop cue's pair rising. That cue is the whole announcement: the voice never says it is back
unless the owner asks, and answers the owner's last words only when they went unanswered
([voice says only what the owner asked](voice-says-only-what-was-asked.md)). **It never gives up** (the owner's ruling: it repeats until it
succeeds): past the last declared wait every attempt waits as long as the last, and an attempt falling due
while the browser is offline waits for the network instead of failing (`reconnectGo`, `ReconnectWait`), made the
moment the `online` event fires.

**An attempt that cannot prepare fails rather than going quiet.** Opening the microphone and loading the call client
is bounded at `CARRYING_PREPARE_TIMEOUT_MS` (60 s, `site/components/voice/prepareCall.ts`) for a reconnect or a
rollover's successor, never the owner's own press: past it the attempt is journalled `failed` with what it was still waiting
on, and the next is scheduled. Without the bound, one call journalled its first attempt scheduled and nothing after.
The attempt that ran out stops being wanted, so a microphone handed to it late is released at once.

**A lost link is heard and seen at once, never mistaken for a slow reply** (the owner's ruling: a drop is known
quickly, or the owner cannot tell a dropped call from one taking time to respond).
OpenAI's SDK ends a call only on ICE `failed`, about 30 s after the network goes. So a live call watches its own link
(`LinkWatch`, `site/lib/callLink.ts`): the browser going offline, or the peer reading `disconnected`, plays the drop
cue and puts `connection lost — reconnecting` on the orb at once, and holds the call for `LINK_HEAL_MS`. A link back
inside that window plays the back cue and the call carries on with nothing lost; one still down ends the call as a drop
and the reconnect above takes over. Three sounds, the owner's pick of distinct sounds over speech (`callDropCue.ts`): the
drop's falling pair, a quiet connecting pip repeated every `CONNECTING_CUE_EVERY_MS` while the orb reads
`reconnecting`, and the back cue's pair rising.

The owner's hang-up, a page left, reloaded or quit, and a start that never went live never reconnect, and no reconnect
outlives the page — the owner's rule: a new call waits for the owner to press start, always.

**A rollover is not a reconnect** ([why](call-rollover.md)): a long call the page replaces in a pause ends
with no drop cue, opens its successor with `--rollover` rather than `--reconnect`, and plays no back cue. Only a
successor that FAILS to open enters this loop, as the first failed attempt of a reconnect for the call it replaced
(`QuietRollover`, `site/lib/callRollover.ts`): the drop cue plays then, because the owner must not believe a call that is not
there is listening.

## The voice window crashed

**A renderer death in the desktop app ends its call on the record and reconnects** (measured on one call: the voice's renderer ran out of memory mid-turn, and the page main reloaded knew nothing, so the
transcript had no end, the plan call waited out its 30-second absent-stream timer and the owner was left with an orb and no
call). The voice reports the live call to the shell (`slopweaver:overlay-call`); on `render-process-gone` main logs
the death and holds a recovery (`desktop/src/overlayRecovery.ts`), and the reloaded page takes it once
(`site/components/voice/useCrashRecovery.ts`). In order: the plan call is stopped with the crash as its reason,
the transcript is closed at the crash with the same words, and a `--reconnect` call opens. It never reconnects
beside a plan call it could not stop, nor after a second crash inside 60 seconds, and says which on the orb. A call or
typed answer the owner starts while those posts are out wins, and the recovery opens nothing beside it. A recovery no page
takes within two minutes is dropped, and one a reloaded page died before taking is kept for the next, which ends and closes the call without reconnecting. A call still connecting when the renderer dies is not covered, nor one whose page dies again after
taking its recovery and before finishing it: the recovery is handed over once, so the server's absent-stream timer
ends that call.

**What to read after a drop**: `~/Library/Logs/Slopweaver/desktop-events.jsonl` carries a `renderer-gone` line with
Electron's reason, exit code, the call's ids and whether it reconnected, then a `recovery-taken` line; the console
server's log carries `talk plan call <id> ended after <n>s: the voice window's renderer …`.

## A call the owner starts minutes after their last

**The owner's last call is the newest one with a line** (`lastSpokenCall`, `src/talk/continuityCalls.ts`), never merely the
newest: a call that wrote nothing is the one being minted or one that opened and closed on nothing, and one of
those, opened by a desktop restart mid-call, once hid the call the owner had just left. A call the owner starts
within 60 minutes of that call's last spoken line opens on its last exchange, both sides (`resumeLines`,
`src/talk/mintOpener.ts`); one stamped after the read, or any when a call file could not be read, is not resumed.
With no spoken call in the window the opener says there is no record, and with the calls unread that they could not
be read, so "where were we" is never answered with a guess.

## A call the owner reopens within a minute

**The owner's own words go first; after three seconds of the owner's silence the voice reminds the owner where the
owner and the voice left off.** The owner's ruling: what the owner is saying takes priority over a reminder, and the reminder comes only after
the owner has been silent for a few seconds — three, at the owner's suggestion. A fresh call minted within 60
seconds of the owner's last spoken call's recorded END (`reopenReminderOf`, `src/talk/reopenReminder.ts`) carries a reminder:
a developer message quoting that call's last exchange, which the voice recaps in one sentence of its own, never the owner's
transcribed words read back. A reconnect, a rollover, a typed session, a dropped call with no end written, or unread
call files carry none; `talk offer` prints `reopen:` when one rides.

The three seconds are the console's (`reopenReminderSilenceMs`, `site/lib/planCallContract.ts`;
`site/lib/talkPlanReopenReminder.ts`). The page posts `ready` the moment its connection is live, which starts the
window, and `speech` the sample its microphone meter hears the owner (`site/components/voice/callOpening.ts`); the owner's
transcribed words, a typed message, or the voice speaking first give it away too. Each step lands in the call file as
a `reopen-reminder` tool line carrying `reopenReminder: { phase, elapsedSinceArmedMs, windowMs, previousCallId }`
(`src/talk/callToolLine.ts`), `elapsedSinceArmedMs` on the call's own elapsed clock from `armed`, so the window is
measured, never two wall-clock stamps subtracted; `slopweaver talk call-tools --call <id>` prints it under each step.

**Proven on the real app by `desktop e2e --call --only call-reopen`** ([the e2e reference](../../skills/desktop/reference/e2e.md)).
A test call is never the owner's, so the owner's calls never remind a test one and a test call never reminds the owner's: `talk offer
--test-instance e2e`, which the console's `e2e-voice` mint passes, reads none of the owner's state
(`src/talk/mintContext.ts`) and, for this reminder alone, only the test instance's own calls
(`testCallsSince`, `src/talk/continuityCalls.ts`), and only while the scenario's arm file
`$SLOPWEAVER_HOME/talk/e2e-reopen-probe.json` names an instant still ahead and a writer still running
(`src/talk/e2eReopenProbe.ts`), and every call leg removes a leftover one the moment it holds its lock. Every other e2e
scenario mints with the arm file absent — a run killed before it removed the file included — so its opening is the
one it judges.

## The link it was reading

**The next call opens the link the last one was reading, never asks the owner to paste it** (the owner's ruling, after
the rollover at the cap asked the owner to paste the Slack thread the owner was walking, which the voice had read
off the owner's reply box and no record kept). An answered read tool whose row takes a `url` writes it on its tool line as
`opened` (`openedLinkOf`, `site/lib/talkTools.ts`) — on a delegated call, on a line of its own once the plan thread
took the answer. A url-taking read it cannot vouch for writes `null` (no usable url, an answer lost or still posting,
a link too long or malformed), and the newest such line then names none rather than letting an older link pass for
it; so does a call file with a torn line, or one whose file order and stamps disagree on which read was newest. Both openers, the voice's on every mint
(a rollover's and a reconnect's included) and the delegated thread's, name the newest call's last link, the tool that
reopens it and the newest claim of at least eight words told after it (`src/talk/continuityReading.ts`); the link is
never clipped, the claim is.

**Every step is written onto the dropped call** (the owner's ruling, after a reconnect tried and
failed and nothing on disk said why). An attempt that never went live opens no file of its own, so each step is a
`reconnect` line on the call it was bringing back, after that call's `closed` line: an attempt `scheduled` with its
wait, `failed` with the exact reason its stop was given, and `live` as which new call; a record written before the
reconnect stopped giving up may also carry a `total` and a `gave-up`, and still reads. They come from
`callEndOutcome`'s journal and `reconnectLiveJournal`. A `scheduled` with nothing after it is the page going away
mid-wait. `talk calls` prints them under that call (`src/talk/callReconnectRecord.ts`).

**A stalled transcript says whose stall it was** (measured on one call: the owner's words stopped for 72 s and nothing
could tell OpenAI from us). The store stamps every segment line `storedIso` as it appends it, beside the page's own
`atIso`, stamped as the page queued the line after OpenAI's transcript reached it. `talk calls` prints the worst gap
between the two under each call, after its steps (`transcriptLag` in `--json`, `src/talk/callLag.ts`): that gap is the
page's queue, the route and the verb, so a stall longer than it happened before the page heard the words, in OpenAI's
transcription.

The transcript sink's `reconnect` is the one way a line reaches an ended call, and it is careful about it:

- a step waits until the route took that call's `closed` line, and goes with it if the close is dropped or refused,
  so no step is written without the close before it;
- on a full queue the step is what goes, never a line of the call now running;
- a step is stamped after its own call's last line, on that call's sequence, so it never moves when the owner's next call's
  lines are stamped;
- a batch of steps alone never holds the one post slot, so a step post that hangs never keeps the owner's next call's lines
  unsent.

A step never changes how the call itself reads: when it was last heard, whether it ended, card landing and the
overtaken-call check all read the call's own lines (`callActivity`). A batch of steps alone keeps the file's write
time where the call's own lines left it, written to a copy that replaces the file in one rename so a crash leaves
neither half (`appendCallEntries`), so every reader that picks call files by when
they were written — `talk calls --limit` and `--since`, the overtaken check — never sees a step. Steps alone for a
call with no file are refused rather than opening one, since a step only ever follows its call's close, and `talk
transcript` lands nothing off a batch of steps alone.
