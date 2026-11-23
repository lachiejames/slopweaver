/**
 * The voice's lines right after its turn-taking ones in the voice prompt (`./sessionConfig.ts`): a handed-back answer
 * is said and nothing of the voice's own is added to it — and its working-aloud paragraph, what it says while work runs.
 *
 * A voice that speaks the thinking model's answer must not close on "Let me check how callers are actually choosing
 * modules." with nothing checking, nor say a draft is in the owner's copy tray when the copy tool refused it. A prompt
 * is the lever for what the voice adds, since the page hears speech too late to stop it; the one line saying a draft
 * is on the owner's running list is the console's own, appended only to the answer of a turn whose `offer_copy`
 * landed (`site/lib/talkPlanHeldRelease.ts`).
 *
 * The second half: when the thinking model asks "Send that bump, park it, or drop it?" and its next answer is empty,
 * the voice must not say "Draft sent." with nothing sent, and must not read "GitHub PR one two three" where the answer
 * named no number. So an empty answer is not news, a proposal, an attempt and a confirmed result are three things
 * said three ways, and a PR number is the answer's own or none. The page catches what is said anyway
 * (`site/lib/talkSpokenClaims.ts`).
 *
 * The third: a question the owner has already waved off with "none of the above" is never put to them again by the
 * voice. The first line here forbids the added question; the last line names the case, and the page takes a repeat
 * back (`site/lib/talkRepeatedAsk.ts`).
 */
export const HANDED_BACK_ANSWER_VOICE_LINES: readonly string[] = [
  "When the thinking model hands you its answer, say that answer and stop. Never add words of your own after it:",
  "no question, no offer ('want me to…'), no talk of more work ('let me check', 'still checking', 'just a moment'),",
  "no claim that something is done, drafted or on the running list, and no 'on it' of your own. This is only about",
  "words you add: still say a question the thinking model wrote, which is part of its answer, and the 'on it' the",
  "console hands you to say as a hand-off starts. An empty answer tells you nothing happened: never fill it with an",
  "outcome. Keep three things apart: a PROPOSAL ('want me to send it?') is a question, an ATTEMPT ('sending it now')",
  "is unfinished, and only a CONFIRMED result — the console's send outcome, or the answer saying it went — is said",
  "as done ('sent', 'posted', 'merged', 'approved'). Never turn one into the next.",
  "A question already put to the owner is settled once they answer — even with 'none of the above' or a question back.",
  "Never ask it again yourself. If the thinking model's new answer asks it, say it because it is part of that answer.",
];

/**
 * The working-aloud lines: a minute of silence mid-work leaves the owner unsure they were heard, but the same word
 * repeated ("checking, checking that") grates, so the voice varies what it says. Periodic "taking longer than expected"
 * words are retired because the words are the annoying part; a subtle sound effect does that job instead. So the
 * audio half — a sound between updates — is the console's (`site/lib/orbCue.ts`), and the voice says no filler on a
 * cadence.
 */
export const WORKING_ALOUD_VOICE_LINES: readonly string[] = [
  "Working aloud: never fill a wait with periodic progress words ('still on it', 'still working on it',",
  "'this is taking longer than expected'). While work runs on, the console plays a quiet sound every so",
  "often instead, so a silence between those sounds is fine. When you do speak mid-work, say what you are",
  "actually doing ('pulling up the screenshot', 'reading the card's PR'), never the same filler twice in a",
  "row and never leaning on one word: 'checking' grates fast.",
];
