# The voice sees the owner's screen when the owner says "look at this"

When the owner says "look at this", the voice responds as if it had just looked. Two changes deliver it, each fixing
a failure class measured on a day's calls:

- **The picture reaches the model as a picture.** `read_screen` and `file_read` live in their own tool namespace,
  `see`, which the delegated Codex thread calls directly rather than from inside its code-mode `exec`
  (`PICTURE_NAMESPACE`, `src/talk/planSession.ts`).
- **The owner's look ask takes the frame itself.** When a turn of the owner's that asks for a look is handed to the thinking model,
  or finishes without one, the page takes one frame and the server steers it into the Codex turn answering the owner, beside one fixed sentence
  of its own (`PlanCall.attachLook`, `site/lib/talkPlanCall.ts`, and `LOOK_FRAME_TEXT`, `site/lib/talkPlanWords.ts`; `foldLookFrame`,
  `site/lib/lookAck.ts`). The reply does not depend on whether the thread chose to call `read_screen`.

**A typed message can ask too, with no call up**: first class, and only on an explicit ask, never constant between
questions. The authority is the owner's words, never the model's choice to call the tool
(`site/lib/typedLookGate.ts`): a message that asks gets one frame through `read_screen`, spent before the capture starts
so two calls in a turn take one, while _"are you looking at my screen?"_ is answered in words and takes none, whatever
the tool attempted. Closing the messenger forgets an ask not yet taken, and the shell refuses a typed look with the
messenger closed (`lookRefusal`, `desktop/src/nativeCapture.ts`). The band credits a look to an application only when
that application stayed in front on both sides of the capture (`site/components/voice/screenLooks.ts`).

## What was measured

Every turn on four calls of one day that asked for a look, said "having a look" or took a `read_screen` frame. Each
was read from that call's own record, `$SLOPWEAVER_HOME/talk/calls/<call>.jsonl` (`slopweaver talk calls` lists
them), with the frames a relay kept from `$SLOPWEAVER_HOME/talk/relays.jsonl`. One of the four is 9 rows long and
holds no look at all.

| Class           | What happened                                                                                         | Example                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| unreadable      | a frame was taken and the model could not see it                                                      | the voice: _"The capture came back, but I couldn't view it properly"_                     |
| no frame        | the owner asked for a look and the thread relayed or read a card instead, never calling `read_screen` | the voice answered _"I see the archive-or-relay card on your screen"_ with no frame taken |
| late            | the frame came from the thread's own `read_screen` call, 7–8 s after the owner's ask was handed off   | four asks across two calls, each 7–8 s from hand-off to frame                             |
| screenshot said | "screenshot" named in passing was heard as an ask, and the voice said it was looking at nothing       | a Datadog screenshot mentioned while describing a dashboard, on two calls                 |

Two classes the steer named were measured and **not** found:

- **The downscale was already readable.** Every frame on those calls is 1183×768, 82–143 KiB — exactly what the
  provider's `detail: "high"` keeps (fit inside 2048, shortest side 768), so nothing was lost to the fit. The
  "could not read it" class was the nesting below, not the resolution.
- **No frame was discarded with a dropped reading.** Zero turns where a frame was taken and the reply was
  dropped by the transcript guard.

## Why the picture arrived as text

Codex runs a dynamic tool from inside code mode's `exec` unless its namespace is listed as direct, and a nested
tool's image comes back to the model as base64 text. Probed against the shipped launch, one 1183×768 frame, the
question "what is on this screen?": nested, **0 of 3** answers described the screen; direct, **4 of 4** did. The
override is `features.code_mode.direct_only_tool_namespaces=["see"]`, passed on the app-server's command line,
and only the two tools that answer with a picture (`answersWithPicture` in `src/talk/talkToolSchemas.ts` and
`src/talk/fileToolSchemas.ts`) move — every other tool keeps code mode's batching.

## Why a steered frame, and what bounds it

`turn/steer` injects input into a RUNNING turn, so the frame lands in the turn that answers the owner rather than a
new one; probed with `read_screen` refused, **3 of 3** steered turns answered from the frame. The frame is taken
at the hand-off, or when the owner's look ask finishes if nothing has handed it off yet, and can reach the server before
the turn has started, so it goes into the newest turn running when it arrives, or the first to start within
`PLAN_CALL_LIMITS.lookStartMs` (1 s); with neither, the console starts the turn itself with the frame as its input
(the next section). **What that does not bind**: the server does not know which turn the hand-off became, so a
turn of the owner's that started inside that second for some other reason would be handed the frame instead — a picture of
the screen the owner had just asked about, labelled as taken when the owner asked. The words beside it are the
server's constant; the page's post carries the picture and nothing else
(`site/app/api/talk/call/[id]/frame/route.ts`). A steer or start written but unanswered within the step, or before
the call ends, is `unsure`, a 504 the page logs as lost, never "not handed over": the line is already on the child's
stdin, so a slow child may still apply it, and a stopping one may already have.

The frame is a look like `read_screen`'s: the edge pulses, a relay this turn carries it, and the call's activity
line records it as `frame` with what was taken and whether the turn took it. A look that throws on the way — the
shell's capture, the encoder — is logged the same way, as no frame taken.

**One capture per ask, even though the thread still calls `read_screen`.** The prompt asks for `read_screen` first
on every look ask (`SCREEN_LOOK_BACKEND_LINES`, `src/talk/screenLookLines.ts`), and the steer lands at the
turn's next step, after that call is already on its way: probed with the steer 300 ms into the turn and
`read_screen` allowed, the thread called it **3 of 3** times. So the page answers a `read_screen` on the same turn
of the owner's, within `ASK_FRAME_REUSE_MS` (15 s) of the ask's look, with the frame the ask already took, and takes a
fresh one only for a later call (`askFrameFor`, `site/components/voice/screenLookSeam.ts`). The owner's screen is
captured once; the same picture can reach the turn twice, steered and as the tool's answer, which costs image
tokens and discloses nothing new. The prompt's last look line names the steered frame as the answer's, for the
turn where it lands first.

**Only the owner's ask takes one.** The matcher (`LOOK_ASKS`, `site/lib/lookAck.ts`) is the same one that says "having
a look", narrowed so that a screenshot merely named is not an ask: "take a screenshot", "screenshot this" and
"my screenshot" are; "a Datadog screenshot" is not. The owner says when to look: no frame is sampled on a timer (the
[drift watch](voice-notices-drift.md) reads window names, never a picture), and a turn that never asked for a look
sends no frame. "Take another screenshot" is an ask too; one call missed it twice.

**A figure the owner corrects is an ask.** Agreeing with a correction is not knowing: the voice should take another
screenshot. The voice had read "A$770 a month" off a frame correctly; the owner heard eight hundred and seventy,
corrected it to seven hundred and seventy, and the voice answered _"You're right, 770 dollars"_ 1 ms later with no
frame. So the matcher also hears a correction:
a reading cue with a correction in it and a figure (`READING_CORRECTION`: _"it actually says seven hundred"_,
_"no, it says 1,240"_), or a figure and the figure it replaces in one sentence (`FIGURE_REPLACED`: _"770, not
870"_) — that second shape only when the owner's turn opened right after the voice's words carried a figure, since
_"invite two reviewers, not three"_ corrects nothing on the owner's screen. Neither cue alone counts: over the 3,898 final
turns of the owner's in every call file, bare `not <figure>` caught three "not ten new PRs, but five" turns and `it says`
caught 238, and the shipped pair adds exactly the four turns of that call — two corrections, two "another
screenshot" — and drops none. A corrected name or date has no shape a pattern holds safely, so it is the prompts'
alone.

**The frame cannot stop the first sentence.** The realtime voice spoke 1 ms after the owner's correction; the page's
capture, upload and steer take seconds. What can stop "you're right" is the voice's own line: a correction is a
look ask, hand it over and say nothing first, never agree before the new frame is read, then say what it shows
and say so when it disagrees with the owner (`SCREEN_LOOK_VOICE_LINES`). A figure is spoken in full words with its
currency named — the voice's transcript said "A$770" twice and the owner heard eight hundred and seventy both times.
`LOOK_FRAME_TEXT` says "their words needed it" rather than "they asked you to look", since a correction never says
"look".

## When the voice says it is looking and hands nothing off

The owner expects about three seconds from "looking now" to the flash. Read from one call's record where it took far
longer, three of its looks were the realtime voice saying the console's own line itself — _"Having a look now."_
1.3 s after the owner's ask — with no hand-off, so no frame and no turn; the next frame came **28.8 s, 98.4 s and
61.6 s** later. The same miss shows sporadically on four earlier calls. The voice imitates the look lines the console
writes into its conversation, so the prompt is not the mechanism that can stop it.

So the console does not wait on the voice. The owner's finished look ask takes the frame whether or not anything
handed it off, and if no Codex turn has started `PLAN_CALL_LIMITS.lookStartMs` (1 s) after the frame reaches
the server, `PlanCall.attachLook` starts the turn itself: one `turn/start` on the call's own thread whose input is
`LOOK_FRAME_TEXT` and the frame (`attachLookFrame`, `site/lib/talkPlanSteer.ts`). The call's record carries a
`look-start` line when it fires, then the `frame` line saying what the start came to. A hand-off that names a turn of
the owner's the page has not seen yet is kept and credited to that turn when its first words arrive, because the hand-off can
land before them.

What makes that turn answer THE OWNER, and out loud:

- **The owner's words** reach it the way they reach every turn: the page sees `turn/started` and steers the call's spoken
  record in (`PlanCall.steerSpokenRecord`).
- **The answer** reaches the voice the way every answer does: the console manages handoffs
  (`clientManagedHandoffs: true`, `src/talk/planSession.ts`), holds each completed message of the thread and hands it
  to the voice once the owner's words go quiet (`site/lib/talkPlanHeldAnswers.ts`), whether a hand-off or the console started
  the turn.
- **A hand-off racing it** costs nothing: a `turn/start` reaching a thread whose turn has just begun adds its input
  to that turn, so the frame is written once either way.
- **Two frames at once** write one start: the call holds its start in flight, and a frame whose wait ends while it
  is unanswered steers into the turn it names. One whose start failed leaves the next frame free to start its own.

Why not ask the voice to hand it over: that was tried, and it did not work. Told to hand the look over, the voice said
_"One sec, I'll find for you. Having a look."_ and started nothing, the frame expired 8 s later, and the owner asked
where the screenshot was, when "have a look" normally gets one within about three seconds. Over every call file
under that design, **1 of 17** such asks got the frame into a turn; the other 16 were answered "Mm-hm.", "'Kay.", "Yep, on it." or a
description of a screen nothing had read, and **20 of 261** look frames expired unused. Repro: each `look-handoff`
line in `$SLOPWEAVER_HOME/talk/calls/*.jsonl` and the `frame` line after it. Words to the realtime voice are not a
backstop.

Probed live (fake microphone, a synthetic page, never the owner's screen; the voice primed to answer a look
itself), the final transcript of the owner's look ask to each step, under that retired developer-message backstop:

| Run                     | Edge pulse | Voice "Having a look now." | Frame steered into the reading turn |
| ----------------------- | ---------- | -------------------------- | ----------------------------------- |
| before, forced miss     | never      | +1.71 s                    | never (no turn in 45 s)             |
| after, forced miss      | +1.10 s    | +1.99 s                    | +3.64 s (1.65 s after the line)     |
| after, voice handed off | −0.01 s    | +2.28 s                    | −0.01 s                             |

The started turn is admitted about 2.1 s after the owner's final words (≈1.1 s capture and post, then the 1 s wait); how
soon the voice then speaks is the thinking model's, and is not yet measured on a live call.

## The replay

Every look ask the shipped matcher hears on the four calls — 17 — re-run through the shipped launch with the
nearest kept frame steered in and `read_screen` refused, so only the steered frame could answer. 15 had a frame
on disk within five minutes. **14 of 15 answered from the frame** on the first run, e.g. _"I can see it twice in the
thread preview: an @ mention showing a raw identifier"_. The one miss took the steer and returned no text; re-run,
it answered from the frame **2 of 2**.

## Still open

- **A frame on every turn while a Queue card or page is in front of the owner.** The handover asked for it; the owner's own
  words on the call did not, and it sits against the rule above that the owner says when to look. It is not built,
  and the question is the owner's.
- **The live check with the owner** — the replay is the old calls' frames, not a call the owner is on.
- **The console-started look, heard** — that the voice speaks a turn the console started, once and without a nudge,
  rests on the app-server's source and protocol, not yet on a live call: the next "have a look" the voice answers
  itself is the witness (`look-start`, then a `frame` line of `started`, then the voice's answer).
