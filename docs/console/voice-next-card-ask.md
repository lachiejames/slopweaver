# The owner's ask for the next card owes a turn, whatever the voice says

A child of [the walk's silences](walk-silences.md#the-page-resumes-an-unanswered-steer), whose owed-start window this
reuses.

In one call the owner said "All right, next card please" while the voice was saying a held answer. It replied
"Pulling it up now. Okay, got it here." and started nothing. The page's promise press read that as no promise, so the
card they had finished stayed up for 40s until their own nudge pointed out that the current card had not even been
taken down. Repro: the segments and tool lines around that ask in the call's file under
`$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl`.

So the server reads the owner's words. A `done` whose last clause is a next-card ask (`walkAskOf`,
`site/lib/talkPlanWalkAsk.ts`; a question counts only as a polite "could you open the next one?") opens the same 2.5s window with no developer message, provided no Codex turn is running
and none started during the utterance (`WalkAskWatch`, `site/lib/talkPlanWalkWatch.ts`). The second condition matters
because the voice usually hands off before the owner's words are final. A late hand-off settles the window. Otherwise the
server writes `turn/start` with `WALK_TURN_TEXT`, which moves the walk before any prose (`triage_next` inside a pass,
else `action_items` then `open_card`), and the call file reads **owed-start**, the reason being the next-card ask. It
outranks a resume's, nudge's or promise's reason in a shared window.

**The residue.** A lone `done` with no delta before it cannot see a turn that started and ended before it. A bare
"next one" answering "this or the next one?" reads as the ask; the turn's own words tell it to judge that again.
