# The walk's silences — a lookup, a relay or the owner's pause never leaves the owner waiting

The rules are in [the walk](voice-context-and-calls.md#the-walk--any-run-of-items-the-voice-carries-it-and-never-goes-quiet);
this page is why each one is there and what it was measured against.

## A lookup never silences a walk, and neither does a relay

The owner wants to be asked the next question while a lookup runs, so that what would otherwise be minutes of
silence is time spent steering.

A Codex commentary message is handed to the voice as soon as it is written, mid-turn, unless the owner's words are still
going (then once they go quiet, below), so when the next question does not
depend on the lookup the thinking model hands it over FIRST as commentary, then looks — and does the same when the owner's
answer reaches it mid-turn. A Queue card's `open_card` (its `read_card` when the owner already has it open) still comes before its question. The backend prompt tells it
commentary is spoken aloud, because without that it opened on "I'll check what a seat means first" and the owner waited.
The server's progress window restarts when the voice is handed a commentary message (`site/lib/talkPlanHeldAnswers.ts`), since a
spoken progress line timed from the turn's start cut the question off. A recap, a statement or a silent relay never ends a turn
while the walk is open (`SILENT_RELAY` says silence about the relay never silences the next question).

**What it cannot reach:** the owner's answer arriving while a tool call is pending is read only when that call returns, so
the next question waits on it; the progress sound covers that gap. `relay_steer` is not one of those calls: the page
answers it at once and posts behind the call (`site/components/voice/relayAttempt.ts`), so a steer
never holds the walk. The progress sound is the page's, never written into the session, so it holds no floor and the
page drops one the moment either side is talking.

## Every hand-off says it is on it, and a long one plays that it is still going

To the owner, hearing nothing at all is indistinguishable from a dropped call. So every hand-off gets a short "on it"
within a second or two, in the voice's own words, never one canned line, then the answer; and once a wait reaches ten to
twenty seconds, a sign that it is still going. Measured on 8 calls: of 192 hand-offs of the owner's words, the voice's first words came a median
4.6s after the owner stopped (p90 15.1s, worst 31.0s), 91 past 5s and 37 past 10s, and only 2 opened on a look or find line.
The voice does not acknowledge reliably on its own whatever its prompt says, and the provider's own filler
(`delegationAckFiller`) invented answers, so the server owns it: `HandOffSpeech` (`site/lib/talkPlanHandOffSpeech.ts`) writes one `appendSpeech` line
1s into a hand-off's Codex turn when the voice has said nothing since, the owner's words are newer than the voice's and have
gone 0.6s quiet, and no line of the server's — a look line above all — is already covering it. Eight seeds rotate
and the voice paraphrases each (`ACK_SPEECHES`, `site/lib/talkPlanWords.ts`); a line still not due 4s in is dropped,
since a late "on it" lands on the answer. Each is journalled as an `ack` tool line in the call file. The residue is
named, not closed: every check reads what the server has heard at the write, a written line is spoken about 1s later
and `appendSpeech` has no cancel, so a voice starting its own answer inside that second hears "on it" land on its
opening words. On the same 8 calls that would have been 8 of 192 hand-offs (a 2s hold made it 15, and pushed 77 past
2s of silence); live, an `ack` line followed by a voice segment under 2s later is that race.

**The "still going" update is a sound, not words.** The owner finds spoken progress words annoying, and wants a subtle
sound at the same frequency instead. So the "on it" stays the
one spoken line, and the periodic update is a `progress` event `HandOffSpeech` sends the page, which plays the
orb's **working** cue (`progressCueStillDue`, `site/lib/orbCue.ts`) only while a Codex turn still runs on the page, the
call is quiet and the owner's sound is on — so one falling due as the answer starts is dropped rather than played over it.
Nothing is written into the session, so it holds no floor: a look, a nudge or a rollover never waits on one. The voice
prompt tells it never to fill a wait with progress words of its own.

The first cue is 15s after the voice last spoke, inside the owner's ten-to-twenty, then every 30s; 30s from the turn's start
would fall past all but the very longest of those 192 silences (9 past 20s, the worst 31.0s). `talk cut-ins` still
reads the calls before the spoken line was retired (`PROGRESS_SPEECH_RETIRED_ISO`, `src/talk/progressLine.ts`) and
counts nothing after it. Repro for the silence: for each `codex … started` tool line between the owner's words and the
voice's next segment in `$SLOPWEAVER_HOME/talk/calls/*.jsonl`, that segment's `atIso` minus the later of the
hand-off and the owner's last segment whose text changed. Live, `grep -c '"name":"ack"'` over a call file counts the lines said.

## A finished thought ends the owner's turn, an unfinished one keeps the floor the owner's

One call held two silences, 116s and 3m20s, each ended by the owner asking whether the voice was still there, with no
lookup running: a finished thought left unanswered. The opposite is the owner's too: on another call the owner told the
voice to stop talking because they were in the middle of saying something. The owner's words had stopped mid-clause under 1.8s before the voice
began, 1 ms after the owner's transcript closed, with a handed-back answer. Classified by hand across every call file, 12 of
the owner's turns complain of being cut off; all 12 cut the owner mid-clause, and 11 came within 0.2s of the owner's transcript closing, 9
of them under 2s into the pause.

So pause length is not the rule. Realtime v3 decides turns itself and `thread/realtime/start` has no turn-detection
setting (the vendored Codex schema has no VAD, silence or eagerness field), so the voice prompt draws the line: a
pause after a filler, a joining word or a clause the owner has not finished is the owner thinking, and the voice stays silent
through it, holding a handed-back answer too; a finished question, statement or steer followed by quiet yields the
turn at once, and never talking over the owner still holds. The page never resumes while `asksToWait`
(`site/lib/waitAsk.ts`) matches the tail of the owner's words, its own list of wait phrasings, of the owner saying they are still
reading as the last thing they said ("let me just keep reading", "I'm still on the briefing"; never a bare "keep
reading", which tells a voice reading aloud to go on), and of trailing "um" or
"and" kin, so that floor stays the owner's until the owner speaks again; on any unfinished clause it does not match, a "like" included,
the 10s resume is the backstop, and the prompt yields to it. Measurement and repro: the header comment of
`src/talk/voiceTurnTaking.ts`.

**A handed-back answer waits for the owner on the server, not on the prompt.** The prompt did not hold it: on a later
call the owner asked the voice to stop interrupting. Four times on
that call the voice began within 1 ms of the owner's transcript closing on an unfinished clause,
each time saying a Codex answer completed 0.15–7.5s before,
which the app-server had forwarded the moment it was written. So the call manages its own handoffs
(`clientManagedHandoffs: true`, `src/talk/planSession.ts`) and holds every message the thinking model completes
(`HeldAnswers`, `site/lib/talkPlanHeldAnswers.ts`): handed to the voice in one `appendSpeech` once the owner has been
transcribed quiet 5s (`RESUME_MS`), 2s after "over", 12s when the owner's words trail off or ask to wait (`asksToWait`),
and the voice quiet 2s; at once when the owner has not spoken; at once on the owner's nudge. Commentary its own turn's answer has
overtaken is dropped. While anything is held no send outcome or rollover takes the gap, and a resume hands over what
is held in place of its sentence (below). Each hold and release
is a `held-answer` line in the call file. A release the session refuses is tried again, three times in all; one with no
answer in time is said as an error and never tried again, since an answer said twice talks over the owner too, so that
answer is lost to the owner and the error line is its one trace. Live on the plan (a headless WebRTC probe), a final answer held
this way was not voiced until appended, then said once in the voice's own words. **What it does not close:** the
voice's own reply, not a handed-back one, can still start in a mid-clause pause, and a barge-in resumes — on the same
call a bare filler from the owner cut the voice off and it carried on 1 ms after; synthesized speech never reproduced either, so the
proof of the fix is the mechanism and the next real call's `held-answer` lines.

**An utterance of the owner's holds the floor from its first delta to its `done`, whatever the gaps between.** On one
call the live transcript of the owner's bug report froze for 72s while the owner talked, the floor read 2s without a
delta as quiet, and the triage clock's line went in over the owner. So the server folds every transcript notification of the owner's
into an open/closed utterance (`site/lib/talkPlanUtterance.ts`): an open one refuses a held answer's release, a send
outcome, a triage line, a pre-start meeting line, a window notice and a rollover, until its `done`, or for 10 minutes
past its newest delta should the `done` be lost (`OPEN_UTTERANCE_MAX_MS`). A resume ignores it on purpose: it is the
backstop for a silence the provider never closed, so an answer held only by that open utterance goes at the resume,
in place of `RESUME_TEXT`. On another call the owner's words stopped and no `done` came for them;
the turn's answer, held 59s later, met the page's resume 5s after that, was refused for being held, and was dropped when
the owner's next words started a turn — the owner saw the voice writing, expected its response to follow, and none came.
The page posts that resume only once the owner's microphone has gone quiet, so a transcript frozen while the owner
keeps talking, as on the bug-report call, never reaches it. On that bug-report call the thinking model's commentary re-read
the last card's question, was released while the owner was saying not to send it, and was said ahead of the same turn's
agreement not to send; the owner hung up 3s later. Commentary of a turn still running that completed before the owner's newest `done` is dropped
unsaid, a `held-answer` line reading `dropped` its trace, since the owner's words reach that turn and its answer is owed.
A resume the call takes also closes that open utterance until the owner's next delta (`closeUserUtteranceOnResume`), so an
answer arriving after it goes too; one the session refuses puts it back (`userUtteranceAfterResumeRefused`). On a
third call the owner's words stopped with no `done`, the resume was taken 7s later, and the
answer Codex wrote 8s after that was held "the owner's utterance is still open" until the owner, 41s on, asked
whether the voice was stuck.

## The page resumes an unanswered steer

The owner sometimes wants to wait before saying the next thing, and ZZZ is worth keeping because it reliably means
nothing is coming. Measured on two calls, 22 silences of 12s or more met no answer and ended with the owner speaking;
the nudge was pressed on none. Four
followed a steer the voice should have carried on from (60s, 17s, 52s, 104s), two were the owner's own announced
waits, about ten were a tool or a card read, and five followed a turn the voice ended putting
nothing to the owner.

Realtime v3 has no turn-detection setting, so the page times it and the server owns the words: 5s into a silence after
the owner's words with nothing in flight (`resumeDueOf`, `site/lib/voiceActivity.ts`), or 2s when the owner's words end on the code
word "over" (`site/lib/overWord.ts`), it posts `/resume`, and `PlanCall.resume`
writes the fixed `RESUME_TEXT` as a `developer` `appendText` — read by the voice, never spoken — or, when Codex's
words are held for the owner, hands those over instead (`HELD_ANSWERS_REFUSAL`, `site/lib/talkPlanFloor.ts`). Probed live against
the real session, that closed the owner's open turn and was answered within 0.8s; through the shipped `PlanCall.resume()`,
the owner's turn closed 0.9s after it and the voice answered the owner's steer — under a sentence that gave the voice its own
turn, which a later call broke (below). Accepted is not answered: on the same session and the same request, seven
accepted resumes in a row went unanswered before the owner spoke again, against 41 of 44 answered within 2s before
that (the repro is on `RESUME_MS`). To the owner it looked like finishing an answer and getting nothing back.
A wait is judged by the owner's words alone
(`site/lib/waitAsk.ts`): told in one sentence to answer a steer and also stay quiet on a wait, the voice answered a
steer with only "Got it.", so the sentence carries no wait clause; "over" outranks a wait said before it ("one
sec. Over"). The page holds it once the voice has sounded since the owner's words, while the owner's microphone sounds — clear of BOTH
its bars, the one answer the orb reads too (`micAudible`, `site/lib/micAudible.ts`), since on one call the owner's quiet room cleared the spectral bar alone, no resume was posted for 44 minutes and ZZZ sat until the owner
spoke — and for 2s after any sound from the owner, transcribed or not, since audio runs ahead of the
transcript — 2s rather than the whole quiet, since on one call "still waiting" showed 12s
after the owner's reply with no resume posted, the one gate it does not share being that hold — and the server refuses it when the realtime session transcribed anyone in the last 2s, since speech can
start between the page's judgement and its post. The owner's mute never holds it: muting after their words is how the owner ends their
turn, and a muted microphone reads as quiet (measured twice on the stuck-voice call above). Muted, a trailing
filler or joining word no longer holds the floor, since the mute is where it cut the owner off (a sentence ending on
"and" at the mute), and nor does a bare trailing "wait", which as often told the voice not to wait;
a wait phrase such as "one sec" or "hold on" still does (`asksInWordsToWait`), unless a negation stands earlier in
its sentence ("Don't hold on. Send it now.", "Do not, please, hold on"). The page marks a silence resumed only once a held call takes the
post (`resumeQuiet`, `site/components/voice/useHeldPosts.ts`). Once per silence: the owner's words' last fragment can land after the
resume (0.7s after, live), so only new sound from the owner re-arms it, and the server refuses a second with nothing of the owner's transcribed since.
The one exception is a refusal of "someone is talking" (`TALKING_REFUSAL`), which a moment clears: it re-arms the same
silence 2s after the refusal, at most `RESUME_RETRIES` (2) times (`transientResumeRefusal`,
`site/components/voice/planWiring.ts`). Each post is numbered, and a refusal re-arms only the newest post of the
silence it answers (`resumePost`, `site/lib/voiceResumeFold.ts`), since an older post's answer can land after a newer
silence began. On the stuck-voice call the one resume was refused that way and the turn sat until the owner spoke. A
silence held past those 5s writes a `resume-gate` line naming the gate and the instants it read, once per gate per
thing the owner said (`resumeDecisionOf`, `site/lib/voiceResumeDecision.ts`; `foldResumeTrace`, `site/lib/voiceResumeTrace.ts`):
8 test calls posted no resume through 20s gaps, their files silent on why. "Still waiting" with its nudge still follows
at 12s if the voice says nothing, so ZZZ keeps its meaning — except while the turn the owner is in now is still open (no
later spoken turn of the owner's has ended past it), when the orb reads "listening, waiting for you to finish" instead, a quiet work row included, since the
server is holding the answer for the owner then. One call drew ZZZ 12s after a Codex turn
completed, while the owner's turn had 18s still to run and the owner's microphone read loud, and the owner reported
seeing it again. The
hold lapses once the page resumed or the owner nudged, and `UNANSWERED_FORGET_MS` after that turn's newest segment, so a lost
final cannot hide ZZZ for good (`ownerTurnOpen`, `site/lib/voiceActivityStatus.ts`). The nudge is the same kind of `developer` message,
`NUDGE_TEXT`: the voice answers the owner's words, which the session already holds, rather than speaking a fixed line asking
the owner to repeat them.

**Each case a real call broke the resume on** — the owner's words in a turn opened after the voice's, a taken developer
message that started no turn, a resume's turn naming a card nobody asked for or moving the owner off the one they have open,
and a promise pressed after its answer came back — is in [the resume's cases](resume-cases.md).

## The turn the voice owes after speaking last

On one call the owner confirmed the voice had understood and thanked it; the voice said "Good, yeah, that's clear." and
stopped, while the owner expected it to say something next, and 236.9s later, with no
nudge or resume line in the call file, it said "I'm right here - keep going." on its own. The page read that silence
as "listening", because any speech after the owner's words counted as the owner's answer. Of 120 voice turns across every call file
carrying "I'm here", "go on", "keep going" or "go ahead", it is the one that followed a turn of the voice's own.

So the page records whether each finished voice turn asked the owner something (`voice-finished`,
`site/components/voice/planWiring.ts`): a closing "?", or a last sentence opening the way a question does when the
transcript dropped it (`voiceAsked`). One that came after the owner's words and asked nothing, with the owner's words not ending on a
wait (`voiceOwesTurn`, `site/lib/voiceOwed.ts`), keeps "listening" but offers **nudge it to answer** from 12s
after the voice went quiet, with no 90s cut-off. It never resumes on its own: about half of the voice's statements
after the owner answered one of its questions were an "Mm-hm." while the owner was still mid-thought. A successor call's fold starts
empty, so an owed turn holds a quiet rollover for 90s (`ROLLOVER_OWED_HOLD_MS`, `site/lib/callRollover.ts`), and
not at all once the lifetime's cut is minutes away ([call rollover](call-rollover.md)), so it cannot hold a call into
that cut. On the press the server reads
its own transcript order: the voice transcribed after the owner gets `NUDGE_OWED_TEXT`, which says the turn is the voice's,
so it carries on from what the owner last said, answering first anything the owner said that was still in flight at the press. Every nudge and resume text, and the voice prompt's turn-taking lines,
say never to hand the floor back with "go ahead", "keep going" or "I'm here".

**A lookup the owner asked for gets a line, then its result.** On one call a request to bring up a named card waited
12s for the voice's first words, then the turn told the owner it could not find the card and kept digging for three minutes.
The owner's ruling: an action is asynchronous unless it really blocks, and even then the voice is never silent the way
a blocked thread is. So the look line's mechanism says "finding it" on a lookup's hand-off (`site/lib/lookAck.ts`),
and the backend prompt ends a lookup that misses in one sentence naming what was checked. Later on the same call a
request to have another look, at a DM on the owner's screen, went 13.3s to the voice's first words: a look with no object, which the
look line hears as one.

**"Voice reading dropped" is not a drop, and not the silence.** Three relays on that call and its reconnect, and every
relay on the reconnect after them — 19
checked by slug — each say it, each naming the four standing sources and nothing the owner asked for beyond a
screen frame they did (one adds `read_screen`). So does nearly every relay ever made:
1,451 of 1,461 rows in `talk/relays.jsonl` are heard-only, 1,313 of them naming exactly the four standing sources and
nothing the owner asked for. A plan thread holds web search, code-mode `exec` and `collaboration` sub-agents from its start,
and the context pack rides in, so `standingReads` (`site/lib/relayGate.ts`) makes every relay carry the owner's words alone
— the injection boundary working, not a fault ([voice boundary](../security/voice-boundary.md)). The owner's words reached
the supervisor each time. The silence on the first of those relays was the unheard look above; the second had none — a
"having a look" 1s after the hand-off, and its next question 0.06s after the owner's last word. Repro: `grep -o
'"readsAfter":\[[^]]*\]' $SLOPWEAVER_HOME/talk/relays.jsonl | sort | uniq -c`.

**Before and after, by class**, over two calls and the reconnect of one. Before is measured;
after is what the shipped rules do with the same moments, driven live only for the resume:

- A steer met with silence, 4 (60s, 17s, 52s, 104s): resumed 5s in. Driven live, the voice
  answered within 0.9s; later, accepted resumes went unanswered (above).
- The owner's own wait, 2: still quiet, as the owner asked.
- A lookup the owner asked for, 1 (the owner complaining of the wait, then asking the voice not to go silent like a
  blocked thread): "finding it" on the hand-off,
  and a miss ends in one sentence instead of 3m24s of digging.
- An objectless look, 2 (6s and 13.3s to the voice's first words): heard as a look, so "having a
  look" on the hand-off.
- A relay refused for its length, 2 (8,824 and 10,011 characters): carried, cut to its newest words.
- Every other tool or card read the voice was waiting on, about 10 of the 22 with the lookup above among them: the
  progress update, not changed here (the working sound).
- A turn the voice ended putting nothing to the owner, 5: not resumed (below).
- "Voice reading dropped", every relay from the objectless look on (19 checked by slug): no silence, no change. It is the standing heard-only
  mode above.

**Not built:** a turn that ends on a statement outside a walk is not resumed — a resume's turn, the thinking model's,
answers the owner's last words, and those were answered. The look and find line is not re-checked on the server: its window is the page's local post,
against the 6–13s the voice took to speak on the calls above, and the server cannot yet tell the owner's transcript from the
voice's.

## Measured

On the real delegated thread (`talk offer`'s own app-server argv and `thread/start`, text turns, real read verbs, a
relay answered with its real note and not performed), replaying the owner's own 55 turns from one call
through both prompt versions. Before: 21 of 55 answers ended by putting something to the owner, and every
one of the 7 answers the owner followed with "next" or "what's next" had stopped. After: 54 of 55 (the other a nod while the owner
was mid-sentence), all 7. Asked on a fresh thread for a candidate the owner had not steered, the old prompts read three
marked unanswered, two of them already settled by the owner's steers; the new ones skipped
seven settled ones, read the one gap, then said "that's the last one" — at the cost of a first answer of 89s against
21s, spent reading the owner's steers. On the orb card the old prompts read the row and the PR and never touched the mockup
or said so (the owner's live complaint); the new ones also tried the mockup and named it as the link that would not open.
Walking three named cards, the first answer read all three and their links, each reaction was followed by the next
card unasked, a question re-put the same card, and the third was named as settled by the owner's earlier steer, then "that's
the last one". The realtime voice half is not driven by that harness; a visible call is.
