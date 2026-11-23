# A draft said to be on the owner's running list with no offer behind it is corrected aloud

Part of [the voice holds to the record](voice-holds-to-the-record.md), which carries the done claims, fleet promises
and repeated asks this shares its correction with.

With no offer run and two of the owner's sentences begun since the last one, the voice can say _"I've put a revision
on your running list that quotes lines and responds to them one at a time."_ when nothing went on the running list.
The prompt already tells the thinking model never to say so itself; the voice makes it up from an answer about fixing
the draft.

## What is read

The page checks anyway. `runningListClaimsOf` (`site/lib/talkRunningListClaims.ts`) reads each FINAL voice sentence
that OPENS on the first person, past or perfect, whose verb places a thing (_"I've put"_, _"I added"_), named in a few
words of a closed vocabulary (_"a new draft"_, _"it"_), straight on _"your running list"_, the sentence ending there or
running on with no comma, dash or bracket into _"that"_ or _"with"_: never a question, a sentence with a negation
anywhere in it, an afterthought after the list (_"…, actually, scratch that"_), a future, a quotation or anyone else's
act.

## What grounds it

The same words are usually true, since the voice paraphrases the console's own line after a real landing, so it is
grounded by an offer landing the owner has not moved on from, told by `useRunningList` once the list's receipt holds
it on this call. The owner has moved on when the owner BEGINS a sentence after the voice has finished one since the
landing: the owner's first heard rather than the owner's FINAL, so an offer landing while the owner is mid-sentence
still grounds the line about it, and only after the voice's reply, because a noise is a sentence of the owner's too (a transcribed _"[lip smack] Okay."_). Nothing consumes a landing, so saying it twice owes nothing: a wrong correction is worse than a missed one. An
ungrounded one is posted as `{kind: "running-list"}` with a key and no words, kept as provenance, and owed the same
`CompletionCorrection` in fixed words: _"Correction: nothing new went on your running list."_

The page is the judge: the claim-grounding route checks a console press and the closed shape, never the fold, so a
console-origin post owes a correction for any kind, exactly as a done claim or fleet promise always has.

## Measured, and what it misses

**Measured** over every call file on disk: six FINAL voice sentences name the running list, three of them
first-person placings, one false and two true; the replays are in
`site/__tests__/unit/talkSpokenClaimsRunningList.test.ts` and `site/__tests__/unit/talkRunningListClaims.test.ts`.
Repro in the module's header.

**Residue**, on purpose:

- an impersonal _"It's on your running list"_ with no offer is not read, because it is the console's own line;
- a claim said just before a slow offer lands is corrected, truthfully for that moment;
- a false claim the voice opens its reply with, on a landing it has not yet answered, is missed;
- a noise of the owner's after the voice's reply ends the landing, so a true line after that is corrected;
- a claim in a sentence that opens on something else (_"I read it and I've put…"_), with a placing verb nobody listed,
  or placing a thing named outside the module's closed vocabulary (_"I've put the incident summary on…"_), is not seen;
- a placing the voice takes back inside a _"that"_ or _"with"_ tail, with no break or negation, is corrected, truly
  but needlessly;
- a second false claim inside `CORRECTION_ECHO_MS` of any correction is kept as provenance and not said aloud, the
  window every correction shares so that a reworded correction never corrects itself.
