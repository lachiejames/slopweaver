# A turn answers the owner once per thing they said

On one call the spoken record was steered into a turn a second time, carrying the transcript of the owner's
question that closed after the turn began, and the turn answered again. Both answers were handed over, and the
owner heard one answer twice in other words, which the owner rated a P0.

A later answer of a turn is dropped when an earlier release the voice TOOK carried that turn's words and no
utterance of the owner's that began after the newest words the turn already answered has finished since
(`splitRepeats`, `site/lib/talkPlanRepeatAnswer.ts`). Order is by arrival number, never the wall clock
(`CallArrivals`, `site/lib/talkPlanArrivals.ts`), and a `held-answer` line reading `dropped` is each drop's trace. An utterance the
transcript closed with no `done` — a taken resume, or the lost-`done` ceiling — leaves no start behind, so the next
`done` begins where it finished; one still open when the voice is handed a release is renumbered as
beginning then, since without an item id a lost `done` and a new utterance read alike — at the hand-off,
because a `done` in the same input chunk as the write's result is read first.

What it deliberately leaves alone, each because the other way loses an answer the owner is owed:

- **Messages in one release** are never judged against each other: a release says a turn's messages joined, and a
  running-list sign-off split across two of them is cut whole only when both halves are in it. So a repeat held in the
  SAME release as its first answer is still said joined; every one of the 76 measured repeats came in a
  release of its own.
- **A timed-out write** sets no bar: the owner is told the answer may be lost, so its turn's next one may be their only
  copy.
- **A turn whose start was never seen, or arrived after it wrote**, sets no bar and keeps the old behaviour.
- **A turn whose own words are not in the taken text** sets no bar (`voicedBars`): half of a sign-off split across
  two turns is cut whole, yet the release still names both turns carried. A run that had a sign-off cut
  across turns names no turn voiced, since which turn's words survived is not knowable from the text.
- **The bar never moves past the turn's start.** A message's stamp says which words it COULD have read, not which it
  answered, so raising the bar to it dropped the answer to words that finished while an earlier answer was being
  written. A repeat of an answer to words begun after the turn started is therefore said again: 1 of the 76
  measured later answers followed such words at all.

Not closed, and not reachable: a listener of a `dropped` line that calls `hold` itself starts a nested release before
this one is in flight, exactly as the superseded and blank drops always could. The call's only listener is its event
sink (`talkPlanCallBase.ts`), and `hold` is reached only from a completed thinking-model message.
Nor is a REPLAYED transcript `done` of words already answered: `CallArrivals.heard` counts every worded `done` as a
new utterance, so a second answer after one would be said, as before this change. The session sends one `done` per
utterance; a replay would only fail open to the old behaviour, never lose an answer.

MEASURED over every call file kept across a week of calls: 76 later answers of turns that had already answered,
1 of them after new words of the owner's. Repro on the incident call: `grep -n <turn-id> $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`
— two `spoken-record` steers, two `wrote` lines, two hand-offs. **The cost:** a second answer that also adds a "Next is
…" (3 of 12 sampled) loses that line with its repeat, so the walk waits for the owner to ask for the next item.
