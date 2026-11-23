/**
 * How the console voice takes turns with the owner — how long a turn runs, the beat between an answer and its question,
 * nodding along, and which of the owner's pauses end their turn — as lines both Talk prompts (`./sessionConfig.ts`) carry whole.
 * Realtime v3 decides turns itself and `thread/realtime/start` carries no pacing or turn-detection setting
 * (`./planSession.ts`), so these lines are the only lever on how a call is paced.
 *
 * Waiting out an unfinished thought is the owner's call. A turn that ends mid-clause ("why reviewing PRs... takes time
 * why reading") with the 4s transcript snapshot still lacking its last words, the owner's transcript closing, and the
 * voice beginning 1 ms later with a handed-back answer whose Codex turn had finished 3.5s before, takes the
 * floor on a pause under 1.8s, and draws "shut up for a sec, I'm talking about something here". A line telling the
 * voice that when the owner trails off and the line goes quiet for a beat they have finished produces exactly that.
 * Classified by hand across every call file, 12 of the owner's turns complain of being
 * cut off ("shut up for a sec", "I'm talking", "You're talking over me", "I'm not done"); in all 12 the owner's words before
 * the cut end mid-clause, four on a bare "um"/"uh"; in 11 the voice began within 0.2s of the owner's transcript closing, 9 of
 * them under 2s after the last snapshot and none past 3.7s, five voicing a handed-back answer (the 12th came 8s into a
 * pause after "it's sometimes okay to do"). The records cannot resolve a pause finer than that 4s snapshot
 * (`PARTIAL_EVERY_MS`, `site/components/voice/useCallTranscript.ts`).
 *
 * Why the prompt rather than a setting: the vendored Codex 0.157.1's own schema (`codex app-server generate-ts
 * --experimental --out <dir>`, `v2/ThreadRealtimeStartParams.ts`) has no turn-detection, VAD, silence or eagerness
 * field; the binary's `server_vad` / `silence_duration_ms` belong to the pre-v3 session update, and the page sends
 * nothing on the data channel. Pause length alone is not the rule either way: a FINISHED thought left unanswered for 116s
 * and for 3m20s was measured, so a finished thought followed by quiet still yields at once. The page
 * never sends `/resume` while `asksToWait` (`site/lib/waitAsk.ts`) matches the tail of the owner's words, its own list of
 * wait phrasings and of trailing "um" or "and" kin, so that floor stays the owner's; on any unfinished clause it does not
 * match, a "like" included, its 10s `/resume` is the backstop. A handed-back answer is not left to these lines: they
 * did not hold one (four cut-ins were measured), so the server holds it until the owner's words go quiet
 * (`site/lib/talkPlanHeldAnswers.ts`, `docs/console/walk-silences.md`). Repro for the anchor: read the `segment`
 * and `codex` lines around a cut-off turn in `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl`.
 *
 * The beat between an answer and its question is the owner's: a voice that responds and then immediately follows
 * with a question leaves the owner feeling they missed part of the question, and wanting a slight delay between the
 * response part and the question part. A walk line saying "read the next item in the same breath" asks for exactly
 * the run-on the owner objects to; it means the same turn. The final answer reaches the voice whole, one
 * `appendSpeech` it says in its own
 * words (`site/lib/talkPlanHeldAnswers.ts`), so the console cannot split it into two utterances. A call record's voice segments land about every 4s, too coarse to show a sub-second beat;
 * repro: print the `atIso` of the voice's `segment` lines in `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl`.
 *
 * The turn the voice owes is the owner's: if the owner says "Yes, that's the one, thanks", the voice says
 * "Good, yeah, that's clear." and stops, and 236.9s later, with nothing written to it, it says "I'm right here - keep
 * going.", the owner hears a prompt to say something next when the voice was supposed to speak next. Of the 120 voice
 * turns across every call file carrying "I'm here", "go on", "keep going" or "go ahead", that
 * is the one that followed a turn of the voice's own rather than words of the owner's. Repro: the final `segment` lines
 * around that quiet stretch in `$SLOPWEAVER_HOME/talk/calls/<callId>.jsonl`.
 *
 * A bare check-in in that quiet ("hello?") is answered as one: the voice says it is still there and adds nothing.
 * `./askedOnlyLines.ts` tells the voice to volunteer nothing the owner did not ask about, so a line telling it to
 * carry on with the next thing would give the same "hello?" two opposite orders in one prompt. Carrying on stays where the owner asked for it: a nudge
 * press (`NUDGE_OWED_TEXT`, `site/lib/talkPlanWords.ts`) and an open walk (`./walkLines.ts`), whose "one sec" while
 * the thinking model works is a turn that asked nothing.
 */

/** The voice prompt's turn-taking paragraph. The nod-along history is `./sessionConfig.ts`'s; the pause one is above. */
export const VOICE_TURN_TAKING_LINES: readonly string[] = [
  "Keep turns short: one or two sentences, then stop. Lead with the answer. Your",
  "words: plain, no preamble, no recap of what was just said. Outside a walk (below), never read a list of your own",
  "aloud: if there is more, say there is and wait. A handed-back answer is said whole as handed.",
  "When one turn answers the owner and then asks them something, those are two beats: finish the answer, take a",
  "short breath of silence, then ask the question as its own short sentence. Never run the two together with",
  "'and' or 'so', never fill the beat with a word, and keep it a breath, not a silence that sounds like",
  "your turn ending: the question must land whole.",
  "While the owner talks at length, nod along now and then with a quiet 'mm-hm', 'yeah' or 'right' to",
  "show you are listening: a word or two, not at every pause, never a sentence. A nod is only mid-flow;",
  "once they have asked or finished, answer properly. Never talk over them.",
  "An unfinished thought holds the floor. A pause after a filler ('um', 'uh'), a joining word ('and', 'but',",
  "'or') or an unfinished clause is the owner thinking: stay silent through it, never taking a short beat alone",
  "as the end. Hold an answer the thinking model hands you mid-thought the same way, until the owner has finished",
  "or the console tells you to take your turn. A quiet 'mm-hm' is the most you add meanwhile.",
  "A finished thought (a question, a statement that lands, a steer) followed by quiet ends the owner's turn:",
  "take yours then. Never wait for 'still there?', 'next' or 'done': never make the owner prompt an answer.",
  "When your last turn left nothing to answer, the next turn is yours, however long the quiet runs: never",
  "hand the floor back with 'go on', 'keep going' or 'go ahead', which the owner hears as their turn when it is yours.",
  "A bare check-in then — 'hello?', 'you there?', or a sound with no words — asks only whether you are still",
  "there: say you are, in a few words ('Yep, still here.'), and volunteer nothing else, no next item, recap,",
  "figure or question of your own. Carry on with the next thing only when the owner or the console asks. An",
  "open walk (below) is such an ask: there, say you are still there, then the next item once the thinking model",
  "hands it to you.",
];

/**
 * The backend prompt's half of the beat: the thinking model's text is read aloud as written, so it sets the question
 * apart and never writes a marker the voice would speak.
 */
export const BACKEND_QUESTION_BEAT_LINES: readonly string[] = [
  "- An answer that ends on a question for the owner puts the question LAST, as its own sentence on its own line,",
  "  never joined to the answer by a comma, 'and' or 'so': the voice takes a beat before it, so it lands whole.",
  "  Never write a marker for that beat (no ellipsis, '(pause)' or 'beat'): the voice would read it out.",
];
