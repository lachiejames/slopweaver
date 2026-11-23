# The page's resume — the calls that shaped what holds it and the turn it opens

The rule is in [the walk's silences](walk-silences.md#the-page-resumes-an-unanswered-steer); this page is each case a
real call broke it on, and what changed.

**The owner's words in a turn opened after the voice's are never answered by the meters.** The page reads the voice
sounding at or after the owner's last sound as it having answered the owner, since the last fragment of the owner's
words can land after the voice spoke them an answer. A real call broke that: the voice said "Mm-hmm. Let me check."
over the end of the owner's sentence, the session closed the owner's turn there and opened a new one for the rest of
it, and the owner's microphone under the voice's audio read RMS 0.000, so it never cleared both bars after the voice's
last sound. The Codex answer was held as "the owner's utterance is still open", the orb drew ZZZ, no resume was
posted, and the owner had to point out, 21s later, that the voice had gone quiet on them again. So the order the
session's turn stream gives outranks that meter comparison: when the owner's latest words are in a turn that opened
after the voice's newest turn opened (`site/lib/voiceTurnOrder.ts`, keyed on the voice's turn ID so the owner can talk
over its tail), the voice sounding before the owner's last sound answers nothing, and the resume is due 5s into the
quiet as for any steer. A turn the owner types after the voice's counts the same way, since the owner's microphone
never sounds for it. A late fragment of a turn the owner was already in keeps the old reading, even after a new turn
of the owner's opened, and the voice sounding after the owner's newest words still holds the resume, since that is its
answer arriving ahead of its transcript.

**A taken developer message is not a turn.** In one call a resume closed the owner's turn, the voice said "On it." and
started nothing; the page's promise press 13s later drew "One sec." and nothing; 143s of silence followed until the
owner spoke. Later in the same call the owner's own nudge drew "Sure, on it." and nothing again, and the owner reported
the nudge bug recurring even with the nudge pressed. Over every call file then on disk, a Codex turn followed before
the owner spoke again after 0 of 6 promise presses, 0 of 17 of the owner's nudges and 6 of 55 resumes with no turn
running; the repro is on `site/lib/talkPlanOwedTurn.ts`. So the server owns the turn, as it does a look's: armed
before the message is written, a turn starting within 2.5s of the session taking it settles it
(`PLAN_CALL_LIMITS.owedTurnStartMs`), and otherwise the server writes `turn/start` with `OWED_TURN_TEXT` itself
(`RESUME_TURN_TEXT` for a resume). The page steers the spoken record into it as into any turn, and the call file
reads **owed-start** naming which press.

**A resume asks the voice only to acknowledge the owner; the answer is the thinking model's.** Mid triage pass, a
resume told to answer what the owner last said and then carry on with the next real thing had the voice offer "the
missing NPM token" as the next card. No card, context pack or call held one — the voice's prompt carries no Queue, so
a "next thing" it names is one it made up — and Codex's own answer was dropped behind it. Over every call file then on
disk, of 152 resumes taken with no turn running, the voice spoke before any handed answer on 126, Codex first on 6,
and 14 voice segments said "next". So `RESUME_TEXT` names no answer, card or next step, and the 2.5s window serves only
to let the owner's last words close into the spoken record before the console's own start; triage still starts at
once. The residue: it is still a sentence the voice may ignore, and the call file shows it as a voice segment longer
than a few words between the `resume` line and the first handed `held-answer`.

**A turn nobody asked for never moves the owner off the card the owner has open.** In one call the owner had opened a
briefing and asked to be left to keep reading; the resume's turn, told to carry on with the next real thing off the
owner's Queue, announced the next card and asked whether the briefing should go back for revision too, about the card
the owner was reading, and the owner cut in to say they were still on the briefing and the voice was sending them to a
different card. So the owner's saying they are reading holds the floor
([a finished thought ends the owner's turn](walk-silences.md#a-finished-thought-ends-the-owners-turn-an-unfinished-one-keeps-the-floor-the-owners)),
and both console-owned turns, `RESUME_TURN_TEXT` and `OWED_TURN_TEXT`, carry one clause (`OPEN_CARD_STAYS`,
`site/lib/talkPlanWords.ts`): an open card, Queue or Alignment, is where the owner is, and only the owner's ruling on
it, "next" or "done with it", moves on. A walk the owner carries still never waits on the owner to say "next" twice,
because the owner's ruling is that word. The prompts' half is `HIS_READING_*_LINES` in `src/talk/walkLines.ts`. The
owner's own "next card please" with no hand-off owes a turn: [the next-card ask](voice-next-card-ask.md).
A start that fails or goes unanswered is the call's `error` event, so the silence carries a reason. A resume or nudge
inside the window joins the one waiting, and a nudge joining a resume's makes the start a nudge's, asked with
`OWED_TURN_TEXT`; one after the server's start is written arms afresh. The triage clock's line has no window at all:
the voice is told only that time is up and a suggestion is coming, never to name a verdict, and the server starts
`TRIAGE_SUGGESTION_TURN_TEXT` the moment the line is taken unless a turn started while it was written, because a voice
asked to hand off for a suggestion said "Send it, then." itself.

**A promise is kept once its answer comes back.** In one call, twice, the voice said "On it.", Codex answered, the
answer was handed over and the voice began saying it, and the page's promise press then landed mid-answer, so the owed
start began a fresh turn and the voice said the same answer twice, which the owner called out as the repetition bug
coming back. The page does not press once a Codex turn has completed since the owner last spoke (`promiseDueOf`,
`site/lib/voiceOwed.ts`): words count as after it only when a stretch of the owner's microphone began after it, held
as long as a cut-in (250ms), and was transcribed after it began, so a transcript fragment arriving late, into a
silence or after a click, never re-arms the press — the cost, a typed line with the owner's microphone silent, is the
owner's own nudge rather than the page's. The server refuses the page's press while an answer waits or is being
handed over, once the voice was handed one after the owner's newest words, or while anyone was transcribed in the last
2s (`nudgeRefusal`, `site/lib/talkPlanFloor.ts`); it never hears the owner's microphone, so the late fragment is the
page's to read. The owner's own press keeps neither check. Said once: [answered once](answered-once.md).

**A promise closing an answer is kept only by work after it.** In one call a Codex turn wrote an answer and completed,
the voice said it and closed on "I'll keep digging." with nothing running, and the owner pointed out that nothing was
being done. The completed turn had read as that promise kept. So `voicePromiseOf` (`site/lib/voiceOwed.ts`) tells a
turn that is only a promise (`whole-turn`, a hand-off, kept as above) from an answer that ends on one (`terminal`),
which only a turn completed after it keeps, and which is due at once rather than after `PROMISE_MS`, since the owner
challenged it 9.059s after its final. So the page presses the nudge itself and real work starts. The digging family
("keep digging", "keep investigating", "dig deeper", "keep looking" bare or before a work particle) and "still on it"
read as promises too; a bare "dig into" does not, since "I'll dig into dinner" is a plan of the voice's own. The page
hears speech too late to stop it, so the voice prompt's ban on added promises (`src/talk/handedBackAnswerLines.ts`)
stays the first lever, and this press is the backstop. A close the press does not read — _"I'm still checking …, okay?
Just a moment."_ after a completed turn — is closed in the prompts, never by widening the press into new work
(`src/talk/fleetAuthorshipLines.ts`).

**A turn begun before the owner's words never heard them, so it never holds their resume.** In one call a Codex turn
started on the owner's steer, the owner's next words went quiet while it ran, the session never closed them, and the
work in flight held the resume for 40s until the owner said "Uh, hello". So, when nothing is in flight but Codex
turns, every one begun before the owner's latest words carrying text, the page posts the resume
(`site/lib/voiceResumeDecision.ts`) and the server lets it past the running turn (`resumesOverRunningTurn`,
`site/lib/talkPlanResumeOverTurn.ts`): the voice is told to say only "Mm-hm." and no second turn starts, so the
owner's closed words reach the running turn as its spoken record. A blank fragment is no words, so it never re-arms
that acknowledgement once said; any other work in flight still holds.
