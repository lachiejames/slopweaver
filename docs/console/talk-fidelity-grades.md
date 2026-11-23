# What `talk fidelity`'s findings are worth, graded by hand

The child of [a summary keeps its source's claims](voice-holds-to-the-record.md#a-summary-keeps-its-sources-claims):
that section is the rule and the reading; this page is how far each finding kind can be trusted, and what the record
cannot say.

## Every kind that fired is graded by hand, and only two are a figure to quote

Every finding on the call that set the rule and up to 25 per kind and hop from the week before it, unsure ones left out, both hops
pooled: `dropped-claim` 32 of 37 real, `added-question` 24 of 25, `added-claim` 21 of 29, `misquote` 20 of 28,
`unsourced-detail` 15 of 24, `dropped-detail` 5 of 9, `polarity-flip` 2 of 40, `swapped-detail` never flagged, so
ungraded. The grades are a constant the report reads (`GRADED`, `src/cli/commands/talk/fidelityClaimsLines.ts`): a
kind real at least 80% of the time over at least ten graded heads the report ("N of M spoken answers dropped a handed
claim or added a question"), every other kind is printed as uncalibrated, and a change to the reading is re-graded,
never re-typed.

Three things the grading found about what is real: most real drops are a whole message the voice never said
("Mm-hmm", or cut off), not one sentence left out; about half the real `added-claim` are filler ("I'll pull that
together"); and a real source-to-answer finding is almost never invention: a label read off the owner's screen, a web read's
link, a call from before tool answers were kept, so it names what the record lacks.

The false positives, most common first: the same negation in other words ("failed" against "didn't work"); clauses
split differently on the two sides (", and", "since", "while" do not break one, and `.”` does not end a sentence);
several held messages voiced together but paired with the last; "on record" missing the owner's words re-cut by transcription
and entity or apostrophe spellings; a number in another form ("within a minute"); a hyphenated phrase read as an
identifier; a paraphrase too far from its words; a negation aligned to an unrelated source sentence; and "two hundred
and thirty" read as 200 and 30. What it cannot see it names: a call with no `wrote` line (one older than those lines), a
message nothing voiced, a torn line, a call whose open line did not parse.

## Whether the failure is new

It cannot be measured from the call files: the older call files are gone, so the day table starts at the oldest one
kept. The class is older than that on the record: the voice's fourteen cards
([the voice says only the counts the app shows](voice-holds-to-the-record.md)), the card draft paraphrased instead of
read ([the card's draft rides the same steer](voice-holds-to-the-record.md#the-cards-draft-rides-the-same-steer)), and
the call where a row named "posted-in" was said as "posted and missed the deadline" (`steerRiskSpeech`,
`site/lib/talkPlanWords.ts`).
