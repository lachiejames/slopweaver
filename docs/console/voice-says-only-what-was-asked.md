# The voice says only what the owner asked, and can say where every line came from

A voice that says things out of nowhere, unrelated to what the owner is talking about, and then cannot say where
they came from loses the owner's trust in every other line. Read across two days of calls, each such line had one of
four sources, and each is closed where it starts:

- **A correction the page handed back.** The page checks each Queue count, PR number and done-claim the voice says
  against the app and the call ([holds to the record](voice-holds-to-the-record.md)). A wrong count or number handed
  back as a correction is a bare figure the owner never asked for — "Everything's ninety-three." said twice in a row,
  off a misread "that's the one it asks for". So the page posts what it found to `count-grounding` /
  `claim-grounding`, the server keeps it as provenance (`PlanCall.recordGrounding`, `site/lib/talkPlanCall.ts`), and
  no figure is handed to the voice. A done claim nothing grounds, fleet work the voice promised as its own, and a draft
  said to be on the owner's running list with no offer landed are the three exceptions: the server has the voice say one fixed
  correction at once (`site/lib/talkPlanCompletionCorrection.ts`), because a false "posted", an "I'll get you that
  briefing" or an "I've put a revision on your running list" left standing is worse than a line the owner did not ask
  for.
- **A relay's delivery, said unasked** (a card on the board but not in the supervisor's chat). The console
  has no line of its own for it, and the opener carries the owner's last steer's words without its state. Where a relay
  went is said only when the owner asks whether a steer landed, never in a recap or a pick-up (`ASKED_ONLY_BACKEND_LINES`).
- **Side remarks and the voice's own alignment questions.** Its prompt invites neither. The thinking model writes an
  alignment question the owner's steer owes; the voice says one only when an answer carries it (`src/talk/askedOnlyLines.ts`),
  and the thinking model keeps their count to itself — "Two quick ones on that first." said three times on one call
  is the shape it prevents (`src/talk/alignmentQuestionLines.ts`).
- **A line the realtime voice made up.** Prompt policy forbids a figure, a status, a side note or a question the
  owner did not ask for, on both halves. A prompt is a probabilistic guard, not an output gate: nothing in the
  repository can stop a generative model forming a sentence. The owner's stop ends a triage pass in a few words, with
  what the owner got through only when the owner asks (`src/talk/triageLines.ts`). One count stays because it is part
  of the question, not news: how many check-ins a verdict's rule covers, so the owner knows how far the owner's word
  reaches before the owner gives it
  (`src/talk/walkLines.ts`).

Of the console's own lines, every one the owner did not ask for — a meeting notice, a drift or ISO nudge, a send held
or failed, a triage card's time up — comes a second after one of four chimes naming its kind
(`site/lib/announceCue.ts`), so the owner knows before the voice speaks that it is not an answer to the owner. A send
that went is not one of them: it is never said unasked ([what became of a send](voice-says-what-became-of-a-send.md)).

So the backstop is the record. Every line the console has the voice say (`speak`) or hands it as an instruction
(`handDeveloperOutcome`) — a meeting notice, a drift or ISO nudge, a send's outcome, a hand-off acknowledgement, a
nudge or resume press — is recorded with the instant before the request, its exact words and why, into the call's
`VoiceProvenanceLedger` (`site/lib/talkVoiceProvenance.ts`) as the request goes out, so a turn steered while it is still
out carries it. It stays on a `result`, a `timeout` or the call ending while it was in flight (`mayHaveBeenTaken`,
`site/lib/talkPlanProtocol.ts`), and is withdrawn on a definite failure unless a steer already carries it. So an
entry may outlive a line that never left (a closed pipe answers nothing, which reads as a timeout); that costs nothing,
since the thread says a line back only when the owner quotes it, and the owner cannot quote one never said. The next spoken record steers those entries into the thinking thread as a `SLOPWEAVER_VOICE_PROVENANCE`
block beside the `SLOPWEAVER_SPOKEN_RECORD` (`steerSpokenRecord`, `site/lib/talkPlanSteer.ts`), quoted data, and
acknowledges them only on a definite `steered`. Until then they stay pending, so a second turn steered at once
carries them too, and one the turn did not take, or did not answer in time, leaves them for the next: an entry sent
twice costs a line, one lost costs the owner an answer. A grounding kept while a turn runs is steered into it by the call
itself (`offerProvenance`), since the page cannot know when a post whose answer it lost was kept, and a record into a
turn already taking one waits for it rather than being refused. An offer no turn took, because none was running or its
turn completed first, is made again to the next turn to start, which no post from the page may carry. A post's answer
is read as the post it numbers, never by its turn, since one turn can be posted to twice. A
voice line cut off as the owner asks about it finishes after the owner's turn began, so it is posted into that running turn
(`site/lib/spokenRecordQueue.ts`) rather than waiting for the next, unless that turn completes first: a completed
turn cannot be steered, so the line waits for the next one, which the owner's asking about it starts. Asked "what did you just say" or "where did that come from", the voice hands the question over and says the thread's
answer as given, so the owner hears the line once. "What did you just say" gets the words only; "where" or "why" gets one
first-person source from the two blocks: my answer, a pre-programmed line and its why, or — in neither — me speaking
with nothing behind it. A grounding entry is never the source: the line's source outranks the writer its why names, and it adds only the
fact the line lacked (what the app shows, no send confirming it, the owner's having spoken since a repeated ask). When the record cannot
settle it (an entry fell off, or the same words were said twice and the record carries no time per line) the answer
is "I can't tell where that came from", never a guess. "I have no record of that" is for the owner's earlier words only,
never a line on this call (`src/talk/spokenRecordLines.ts`). Asked about a line the record does not hold yet, the one
a completed turn never saw, the thread says it has not reached it yet and asks which words the owner means, never
guessing the line or denying it. To the owner there is one voice, so neither model says "the voice said" or disowns a
line the owner heard: a thread writing "The voice said …" and a voice reading back "Not from my reply. Nothing to act
on." leaves the owner unable to tell which lines come from the voice and which are pre-programmed responses.

**The trade.** A wrong count or PR number is not retracted aloud: it is kept for the thinking model and written to
the call file, and the owner hears about it only when the owner asks. A retraction the owner never asked for was the
very thing the owner filed.
A false done claim is the narrow exception, corrected once in fixed words, after a replay over every call showed the
check owes only inventions (the [measurement](voice-holds-to-the-record.md#a-done-claim-nothing-on-the-call-said-is-corrected-aloud-a-pr-number-is-kept)). The ledger keeps the newest 12 entries, each field bounded, so a long run of steers that never land
drops the oldest; the next record the page posts (it posts one only with the owner's or the voice's lines or a card
draft, so the owner's asking is itself one) carries a block saying how many fell off, even when no entry rides with it, and the thread then says it cannot tell where an unfound line
came from rather than blaming the realtime voice. A grounding post still unlanded when the call ends is written to
the call file as not recorded ("the call ended first", `site/components/voice/voiceRecordWiringPoster.ts`) and never
retried: the ledger answers the owner on this call, and the server refuses a post to an ended one.

**Measured** by replaying 30 written synthetic lines, in the seven shapes and counts the two days of calls held,
through the new shape
(`site/__tests__/unit/unpromptedVoiceReplay.test.ts` and `src/__tests__/unit/talk/unpromptedVoicePrompts.test.ts`,
fixture `src/__tests__/fixtures/unpromptedVoiceLines18To19Oct.ts`):
it proves the repository has no producer left for them and forbids the model behaviour, not that a model obeys.
