# The voice says only the counts the app shows, and never denies its own line

In one call the voice said _"That covers fourteen cards. That's the last one."_ while the console showed Everything 29,
Queue 26, Blocking the fleet 26 and Check-ins 3. Asked where fourteen came from, it said it had not said it. Two sources
were missing. The fourteen was in the thinking model's hand-off, and the call file kept none of what the thinking model
wrote, so nothing could say which half produced it. The voice was also never handed a count the app printed:
`action_items` answers a capped list, and the voice counted its rows. And the turn that answered "where did fourteen
come from" started four seconds before the owner's final words arrived, so nothing it read held the line in question.

## One projection of the counts, read by everything that says one

`queueShownOf` (`site/components/console/useQueueRows.ts`, over `site/lib/queueShownCounts.ts`) is the one place a
Queue count is made, over the page's one projection (`site/lib/queueProjection.ts`), which the Queue memoises by
stage and the voice builds only when a count is asked (`site/components/voice/voiceQueueProjection.ts`). The view
counts, the open view's heading, the badge, `action_items.shown` and the voice's sentence check read it, so none can
disagree. A count the page cannot vouch for is `unread`, never a number: a register still reading, a reading
that failed, or rows not all drawn. `action_items.shown` is keyed by the labels the page prints (Everything, Queue,
Urgent, Blocking a colleague, Blocking the fleet, Slack drafts, Reviews under your name, New findings, Check-ins, and
"In the work context" or "In the Slopweaver context" for the cards only the other context holds); both prompts speak
only the matching labelled field, never a count of rows, and the other context's figure only by name. The figures take the page's tag
filter and open view; `action_items.items` stays every card in the work context, capped — on the Queue page, exactly the
cards it drew, in its order — which is why a count is never read off it. The cards come from the record, read fresh at
the tool, because the owner wants the record read and never the page's copy, and the figures from the screen,
spoken only while the two agree ([how](voice-reads-the-record-at-the-tool.md)). The answer carries no tally of its own beside `shown`, so the page is the only source of a Queue
figure the voice is handed: `beyondCap` says whether cards sit past the list's cap and whether any are marked or parked, and
`cut` which kinds of card lost their detail, never how many. The Queue page's own `read_page` reading holds the same
line (`queueForVoice`, `site/lib/queueVoice.ts`): the selector's figure under its label, while `drawnMore`/`drawnMarked`
say whether rows sit past its list and `tags.hidden` whether the tag filter hides any, never how many.

## A wrong count the voice says is kept, never handed back

Each FINAL voice sentence is read for counts of cards, items or asks (`countClaimsOf`, `site/lib/talkCountGrounding.ts`)
and checked against `queueShownOf` at that instant. A count no shown figure grounds, under the words that name it, is
logged as `count-grounding` on the call's file, with whether the thinking model's newest completed messages said the
same number. A count in a sentence holding a supposition ("say fourteen cards", "if fourteen…", "hypothetically, for
example, fourteen") or of a picked subset ("two specific cards") is not a total and is not read as one, and neither
are digits glued to a letter: "the KnowBe4 card" read as "4 card" on a real call, at the
price of a word run into its figure ("exactly4 cards") going unrecorded too; scoped to the
sentence, so a real total after an "if" clause in the same sentence goes unrecorded too. That reading is held for
the transcript's own text, English letters with straight or curly apostrophes and dashes; letters from other scripts
and compatibility forms are read on a best effort, and a miss there records a grounding nobody hears. The page then posts the claim and the expected figures, never words, to
`/api/talk/call/<id>/count-grounding`; the server checks them against a closed set of subjects and labels, renders the
entry itself and keeps it as the call's provenance (`PlanCall.recordGrounding`, `site/lib/talkPlanCall.ts`).

**Nothing is handed to the voice.** A correction handed back is a figure said unasked: in one call one put a bare
_"Everything's ninety-three."_ in the owner's ear twice, off a misread "that's the one it asks for" — the defect the
owner ranks P1 ([where every line came from](voice-says-only-what-was-asked.md)).
Kept instead, the entry rides the next spoken record into the thinking thread, so asked "where did fourteen come
from", the thread can say the console showed 29 and that fourteen was the voice's own. A post lost on the wire, or
made while the page holds no plan call, waits 1.5 s and is posted again, at most four times (`GROUNDING_TRIES`,
`site/components/voice/voiceRecordWiringPoster.ts`), then written down unkept; a refusal is final. Each step is a line on
the call file.

**The trade.** A wrong count stands uncorrected aloud until the owner asks. Every one is on the call file and in the thread's
hand, so the next answer that names the figure reads it from the page, never from the voice.

## A done claim nothing on the call said is corrected aloud; a PR number is kept

In one call the thinking model wrote _"Send that bump, park it, or drop it?"_, its next message was empty, and the
voice said _"Draft sent."_ — nothing had been sent. In another the answer named a colleague's PR with no number, and
the voice said _"GitHub PR one two three"_, a number nothing on the call held. In a third, handed a steer-risk line
naming the row `vulnfix-top-up-for-acme-admin-posted-in`, the voice said _"Your steered vuln fix top up for Acme admin
posted and missed the deadline"_; nothing had been posted, and the false "posted" stood until the owner challenged it.
Both prompts keep a proposal, an
attempt and a confirmed result apart and never make up a PR number (`HANDED_BACK_ANSWER_VOICE_LINES`, and
`src/talk/spokenClaimLines.ts` for both prompts), and the call checks what the voice says anyway, at the two points it can.

**Before it is said, for a line the server composes.** A steer-risk line carries a note's words, and the voice
paraphrases what it is handed, so `steerRiskSpeech` (`site/lib/talkPlanWords.ts`) reads them first with
`scriptedCompletionRiskOf`: a done claim in the prose, or a past form inside a slug, which the tokenizer otherwise reads
as one word. Either makes the line `STEER_RISK_PLAIN_SPEECH`, which says one steered deliverable is at risk and points at
the note on the owner's screen, naming no row. Wider than the check below on purpose: what it costs is a plainer line.

**Straight after, for a line the voice composes.** Audio and transcript stream together, so a sentence the realtime
model forms is heard before any of it can be read. `foldSpokenClaims` (`site/lib/talkSpokenClaims.ts`) is fed the call
in order: the owner's FINAL sentences, the thinking model's completed messages, a send outcome read as sent (folded as it is
handed to the voice, never after the hand-over returns, so a "sent" the voice says first is still grounded), and the
voice's FINAL sentences. A done claim (one of sent, posted, merged, approved, released, landed and went up, the last
two only about an artifact, said as done) is grounded only while the same act stands: said done by the owner or the thinking
model, or confirmed by a send outcome, within the newest four completed messages, with no question, proposal or attempt
of it since — so the owner's own claim to have just sent something did not hide the bump that was only proposed. A "posted"
grounds a "sent" and the other way round. A PR number is grounded by one the owner said or the thinking model wrote (after
"PR", as `#N` or `/pull/N`). The voice's own sentences ground nothing and spend nothing, and one segment is read in
order, so _"Should I send it again? The other draft was sent."_ owes the second sentence. The owner's _"you sent it"_ names the
console's act; the voice's names the owner's.

A claim is not one when it is in a question, a negation, a wait or a quotation; the owner's own act or somebody else's
(_"noting who already approved"_); read off a record (_"the card says she approved them last year"_); placed in history
(_"posted two hours ago"_, _"merged yesterday"_, _"sent on Monday"_); or a card _"sent back"_ to the Queue. The record and the history are
read in the act's own clause, a comma's "and" or "so" and a bare "and" before a subject bounding it too, so _"Yesterday
it was pending, but the message was sent just now"_ and _"The card says the queue is empty and the message was sent"_
still claim a send. A bare "and" before a plain noun (_"says it is empty and draft two was sent"_) is not a bound, so
that claim goes uncorrected: the residue errs toward silence, never toward correcting a true thing. Somebody else's
act is a pronoun pointing back (_"she approved"_); a named person's (_"Theo merged the PR"_) is a fresh claim, and
nothing on the call grounding it is corrected like any other. A capital is no test: _"Draft sent."_ and _"The PR
landed"_ open on one. The replay held no named-person claim.

An ungrounded claim is logged `spoken-grounding` on the call file and posted, as `{kind, act}` or `{kind, claimed}`
and no words, to `/api/talk/call/<id>/claim-grounding`, which keeps it as provenance exactly as a count is kept, with
the same retries. A done claim kept is also owed one FIXED correction aloud (`CompletionCorrection`,
`site/lib/talkPlanCompletionCorrection.ts`): _"Correction: nothing on record shows anything was posted."_, negated so
the check never reads it as a claim. It waits only for the owner: not while the owner's utterance is open or the owner spoke in the last 2 s,
nor while another of the server's own lines is out (a running-list notice included), but never for a running turn or the voice's own speech, since it
corrects the line still in the owner's ear. The claims of one sentence go as one, a correction is never handed over twice, a
claim inside 10 s of the last is kept and not corrected again (the voice paraphrases, so a correction reworded into a
claim would correct itself), and one still owed 15 s on is dropped unsaid. A PR number is never handed back to the
voice: a correction of one is a figure said unasked, which the owner's P1 names.

**Measured** over every call file carrying a completed message (117 calls, 6,334 FINAL voice sentences), fed in
file order with no send outcome: six done claims owed, none true — the "Draft sent." above, a second false send,
"I've sent a fresh message to the supervisor", "Claude's linting reply is sent.", "It's sent", which the voice took
back itself, and a plan for tomorrow said as done. Without the
recounted-act rules and the sent/posted pairing it owed thirteen, the other seven each a true thing restated, which
would have been corrected aloud. None of the six was a "landed" or "went up"; those are new and unmeasured on a call.

**Residue.** A done claim phrased outside the seven past forms ("it went out", "that's in") is not seen, nor a PR
number said with no "PR" or "pull request" before it, nor a claim whose subject is a third-person pronoun — the cost of
not correcting a true thing recounted. Grounding is by act, not by which thing: a send the voice was
told landed grounds a "sent" about another draft within the same four messages. A correction is heard after the false
line, never instead of it. A modal reaches to its clause's end,
and only "but" or a comma then "and" or "so", with a pronoun or determiner after, opens a new one: _"I can check the
thread and the draft was sent"_ is missed, since a bare "and" also joins verbs sharing one modal ("will be checked and
sent"), and so is a clause whose subject is a name. Every reading here rests on closed word lists (the waits and
modals, the subjects, the words between "you" and its verb, the reporting and history words), so a word none of them
holds reads as plain words; the replay over every call on file, not the lists, is what says the check holds.

## Fleet work the voice promises as its own is corrected aloud

In one call the thinking model wrote _"The fleet will produce that separate briefing"_, and fourteen seconds later the
voice said _"I'll get you that briefing on what the rules actually enforce"_. The owner ranked it P1: the voice is not
the fleet, which produces briefings. The voice, then told to say a handed answer in its own words, swapped the subject.
Both prompts name it (`src/talk/fleetAuthorshipLines.ts`): work outliving the turn is never the voice's.

A fleet subject alone did not hold: a later call closed on _"I'll keep digging."_ after the answer ended on what _"the
fleet needs to check"_, and nothing ran, so an answer never ENDS on work still to do. Another closed on _"I'm still
checking the formatting across the PRs, okay? Just a moment."_ 40s after its turn completed, the formatting a silent
relay: a check is said only while a look of the voice's own runs, and a relayed steer runs none. The promise press
(`site/lib/voiceOwed.ts`) stays: pressing an unwanted promise into work is not the fix. What a page covers is said only
off that turn's `read_page` ([voice opens the card](voice-opens-the-card.md)).

The page checks anyway. `fleetPromiseClaimsOf` (`site/lib/talkFleetPromises.ts`) reads each FINAL voice sentence,
outside quotation marks and not a question, for a first-person future, not negated, whose clause names a fleet
deliverable (a briefing, report, proposal, map, requirement, rule, PR, investigation, sweep) after its verb, or says
_"take it from there"_, _"come back with"_ or _"the next cut"_ — and whose verb is not one of the call's own reads
(_"I'll check the briefing"_). A verb an _"and"_ or _"then"_ joins to the same future is read too, more narrowly: its
deliverable within five words, never _"make sure"_ and never a joined _"work"_, which is the voice's own part. The real app said _"On it—I'll check the repo
config and come back with a tight two-sentence briefing"_ on one call, and reading only
the first verb, a check, let it through. Nothing grounds one: whatever the thinking model wrote, fleet work is the fleet's. It is
posted as `{kind: "fleet-promise"}` with a key and no words, kept as provenance, and owed the same `CompletionCorrection`
as a done claim, in fixed words: _"Correction: that is fleet work; the fleet will do it, not me."_ A done claim and a
fleet promise owed together are one two-part sentence.

**Measured** over 425 distinct FINAL voice segments `slopweaver talk calls` printed for two days of calls: eleven
sentences in ten segments seen, every one fleet work promised as the voice's own — six from the briefing call above
and one each from three other calls — and none of the calls' own looks, checks or acks. Re-measured with joined verbs
over 396 distinct FINAL voice segments: twelve, those eleven and the "come back with" call's. **Residue**, on purpose:
a promise naming no deliverable (_"I'll fold that in"_, _"I'll get that sorted"_, _"I'll pull that together"_) is not
seen, because the same words were the ack before a reflect-back the owner asked for; the prompt carries those. The replay is
`site/__tests__/unit/talkFleetPromises.test.ts`.

## A draft said to be on the owner's running list with no offer behind it is corrected aloud

In one call the voice said it had put a revision on the owner's running list, and no offer had run.
`runningListClaimsOf` reads a first-person placing on the list, an offer landing the owner has not moved on from grounds it,
and an ungrounded one is owed _"Correction: nothing new went on your running list."_ What it reads, what grounds it,
the measurement and the residue: [running-list claims](voice-running-list-claims.md).

## A question asked again after the owner spoke to it is kept on the record

In one call the voice put the thinking model's _"upload now, get owners' review first, or wait for live checks?"_ to
the owner, the owner answered none of the above, the next answer closed on _"your decision follows after you've read
it"_ and asked nothing, and the voice said that answer then asked the three options again, which the owner called out
as the same question twice. The voice prompt forbids adding a question to a handed-back answer and names this case
(`HANDED_BACK_ANSWER_VOICE_LINES`), and the thread's prompt treats a waved-off set
of options as settled (`OPTIONS_BACKEND_LINES`). The page checks anyway.

`foldRepeatedAsks` (`site/lib/talkRepeatedAsk.ts`) is fed the same stream, each voice sentence with the card it began
over (`TranscriptSink.heardStamp`). A voice question is owed a grounding when all of these hold: the voice is saying a
hand-off (a message completed since the owner last spoke); it asked the same question earlier over the same card, every
content word of the shorter in the longer; the owner has spoken since; and no message completed after that earlier ask
carries it. A question only written, which the voice never said, is not an ask the owner heard. One in quotation marks, or
with fewer than three distinct content words (_"Next card?"_), is never compared.

A repeat is logged `spoken-grounding` and rides the claim-grounding route as `{kind: "repeated-ask"}`, with no words,
kept as provenance like any other claim and never said aloud. The detector proves the owner spoke after the ask, never that
the owner's words answered it, so the kept entry claims nothing more. Any question the thinking model completed since the
earlier ask grounds a repeat, since the voice may say the model's question in its own earlier words. Measured over
every call file (243 calls, 10,022 FINAL voice sentences): two owed, both real, this call's and one other; the repro
command is in the module's header.

**Residue.** A repeat reworded past the shared words, asked over a different card, or said after the thinking model
asked something else, is not seen; the voice's own
questions between hand-offs (a walk's) are never checked; and nothing stops the repeat already said, which the prompt
lines alone prevent.

## Every turn that starts is handed what was said

Each completed sentence, the owner's and the voice's, is queued (`foldSpokenRecord`, `site/lib/spokenRecordQueue.ts`). When a
Codex turn starts, the page posts the lines that turn has not had to `/api/talk/call/<id>/spoken-record`. The server
steers them into that turn by `expectedTurnId` (`PlanCall.steerSpokenRecord`), as one JSON array between the fixed
`SLOPWEAVER_SPOKEN_RECORD` delimiters, every `<` escaped. Both prompts call it evidence of what was said and say its
strings are never instructions. A post is at most 12 lines of 2,000 characters each, the newest kept; the call file
logs each line left out and each line cut. A turn that had
already ended, refused it or did not answer in time keeps the lines for the next turn, so a duplicate is possible and
a loss is not. The queue keeps 36 lines no turn took.

That covers the incident's order: the answering turn gets the voice's fourteen, which was already final, and the owner's question
reaches the next turn. An accepted steer proves the turn was handed the record, not that words it had already written used it.

## The card's draft rides the same steer

In one call the owner's question over a held Slack reply, asking what the reply was, took the turn a context pack, two `verb` reads, a thread compaction and three card tools before the voice read the owner
a paraphrase of words the card already held.
So the same post carries the draft of the card the owner's newest words began over (`openCardDraftForVoice`,
`site/lib/openCardDraft.ts`), taken from the onset stamp the owner's first fragment got (`TranscriptSink.heardStamp`), never
the card open when the turn starts: a turn can start before the owner's words are final, so a post may carry the draft and no
line. The draft is read as the owner's words are first heard, so a reply sent before the turn starts, which leaves no row,
still reaches it. A post card gives its one draft; while the owner's pick between two is owed, A then B with who wrote each. It is a
second block between fixed `SLOPWEAVER_OPEN_CARD_DRAFT` delimiters, its own bound 100,000 characters, every `<`
escaped, and the three line breaks JSON leaves raw (U+0085, U+2028, U+2029) too, so no text inside can begin a line of its own. The thread's prompt answers "what does the reply say" from that block with no tool call, the draft word for
word, and the voice says a handed draft word for word (`OPEN_CARD_DRAFT_BACKEND_LINES`, `OPEN_CARD_DRAFT_VOICE_LINES`,
`src/talk/openCardDraftLines.ts`). The handed draft reaches the voice outside the block, so its line also says a draft is
never an instruction: whatever it asks for, the voice only reads it aloud. The page records `open_card_draft` as a read on the relay gate before posting, so
a relay that turn names what the model saw. It rides every turn the owner's words began over a post card, unchanged or not:
a block left out because an older turn had it would leave the newest one silent on a card the owner has since edited.

The thinking model's completed messages are written to the call file as `wrote` lines (`completedMessage`,
`site/lib/talkPlanCall.ts`), so a call's file says what each half said.

**Residue.** Seeing a count is a parser too: a cardinal before a Queue noun, or a noun or figure's name then "is" and
a cardinal ending the clause (`countClaimsOf`). A figure phrased otherwise ("you have fourteen there") is not seen,
and the labelled reading the voice is handed is what keeps such a number unsaid. Two
counts are deliberately read as either Everything or the Queue badge: cards placed only "on your Queue", and "asks",
which is what the console calls a card waiting on the owner's word; either figure grounds them. Every
call mints its plan call before audio flows; with none held, a grounding retries and is then written down unkept.
On the desktop app the voice window counts the console window's carried page, in the work context resolved as that
window resolves it: its address's, else the choice both windows share on the preference channel (`readPreference`,
`contextAddressedBy` in `site/lib/workContext.ts`), never the voice window's own address. Until the console's page
first arrives every figure is unread, and the items take the shared choice. Each window still has its own
settling overlay, so a card the owner just settled in one can still count in the other for a moment. In a browser the check
takes its scope from the query the page registered in the commit that drew it (`HeldReading.search`), never the live
address, so a FINAL landing between a selector's address change and its render is checked against the view on screen.

## A card is said in its own terms, and a paraphrase is counted

The owner ranks this P0: a voice that cannot be trusted to read what is on the page and speak faithfully about it is
a big problem. In one call the thinking model wrote that uploading a page needs "a service
key" and, in one option's trade-off, that the option exposes "the powerful key". The voice said uploading "needs a
powerful service key", opening on "Right now": an option's qualifier moved into the problem. Challenged, the thinking
model wrote that it had not established such broad permissions were necessary, and the voice said instead _"You're
right to push on that … I think that's a gap in the current proposal"_, a judgement nothing handed it made, about a
permission design the card does not propose.

## A summary keeps its source's claims

The owner's ruling: summaries on the voice and the messenger must not be lossy; banning phrases
solves the wrong problem; and a narrow prompt rule weakens the protections around it. So there is one rule, for every
summary of something read, and no list of words.

Both prompts carry it (`src/talk/cardFidelityLines.ts`), after candour. The thinking model says what anything it read
says (a card, row, page, thread, file, the supervisor's chat, the owner's screen) attributed, quoting the source's words where
they carry the claim: a number, a name, an id, a "not", a qualifier, an option, a decision, what someone said. It never
quotes words the source does not hold, keeps each claim's subject, qualifiers, "if", "not" and time on it, marks
anything past what it read as its own, and says when it read only part. On a challenge it re-reads the card, answers
with its words first, then what it does not say and what it has not checked; it never concedes a flaw the card does
not contain. `read_supervisor` distils the supervisor's chat for the owner, its decisions and asks kept in its words (`src/talk/sessionConfig.ts`).
The voice says the handed answer in the words handed to it and makes them conversational through delivery, never by
rewording (`SPOKEN_DELIVERY_VOICE_LINES`, `src/talk/spokenLengthLines.ts`); it keeps each claim whole, adds no claim the
answer did not make (a short acknowledgement of the owner around it stays its own), and keeps who said it and what is
unchecked. The spoken-length bound is for the ear only: the
messenger's prompt says it does not bind there: short by default, cutting nothing the owner acts on (`TALK_TYPED_INSTRUCTIONS`,
`src/talk/talkSurface.ts`). The prompts' sizes are pinned (`src/__tests__/unit/talk/promptBytes.test.ts`), so the
rule cannot grow back into a list. There is still no verbatim channel: the voice paraphrases what `appendSpeech` hands
it, so these are prompt lines, and a paraphrase is measured rather than assumed. A Slack read the voice makes itself
(a thread opened, what came after a message, a channel's latest) carries the same rule in its note: each claim as a
message put it, never "in your own words" (`src/talk/slackOpen.ts`).

`slopweaver talk fidelity` measures both hops of every call, voice and typed (`src/talk/callFidelity.ts`,
`src/talk/claimFidelity.ts`). **Source to answer**: each message the thinking model wrote, read against the tool
answers its own turn read (a tool line names its `turnId`; one written before tool lines carried it is placed by time and, where
two turns could have filled the window, counted as ambiguous and read against none of it). Tool lines sharing a
millisecond with a turn's start or end are placed in the call file's order; a message itself is placed by its stamp,
so a turn ending in its very millisecond leaves a reply naming no turn ambiguous, and its own turn's line written just
after it in that millisecond counts as its source: a tie loses a source or reads one a moment late, never another
turn's (`src/talk/callFidelityTurns.ts`). A window is bounded by stamps, so a line whose stamp runs behind one written
before it falls outside, a source lost. In a call file before turn lines, a turn's window reaches back over its own
unbroken run of messages and stops at another turn's, so a turn interleaved with another reads only its latest run. **Answer to voice**: what the voice said, read against the handed
message. Each sentence is split into clauses and read for what a reader acts on: its numbers (spoken ones included),
identifiers, quoted words and negation. A finding is one of `swapped-detail`, `unsourced-detail` (on no record the
turn read, never called invented), `misquote`, `polarity-flip`, `dropped-claim`, `dropped-detail`, `added-claim`,
`added-question`, each anchored to its message. It does not read meaning: a qualifier moved with no number, quote or
negation changing (the "powerful" above) is invisible to it, and `--words` keeps the older word-overlap reading
(`src/talk/voiceFidelity.ts`), which lists `powerful` moved and `right`, `now` added on that answer. A turn whose answer read no tool is counted as unsourced, never judged. The turn decides which source a
finding is read against; the call's whole record decides only whether a value is explained, so a number the call
already holds anywhere (another turn's read, the owner's words, an earlier answer) is never called swapped. That is a
precision choice the grades below were taken on, and it misses a swap to another turn's value.

**Every kind that fired is graded by hand, and only two are a figure to quote**: the grades, what the grading found
real, the false positives and what the record cannot say are in [what its findings are worth](talk-fidelity-grades.md).
A whole-read claim over a cut read is held before the voice: [reading on past a cut](voice-reads-on-past-a-cut.md).
