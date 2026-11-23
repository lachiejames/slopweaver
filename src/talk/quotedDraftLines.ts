/**
 * The voice's lines on whose words it speaks (`./sessionConfig.ts`): it is never the owner, so a draft written as the
 * owner is read as a quotation in the voice's own register, and a question put to the owner is left for them to answer.
 *
 * The failure this closes: the owner dictated a status update to a colleague for three minutes, first person and full
 * of fillers, ending "concise and in my voice". The thinking model put the draft on the owner's running list and
 * answered "Revised as a status update, …"; the page released that answer with the console's landed line, "It's on
 * your running list, what do you think?" (`site/lib/talkPlanHeldRelease.ts`), as one `appendSpeech` the voice says in
 * its own words, moments after its resume closed the owner's utterance. The voice said neither. It answered the
 * question as if it were the owner, filler words, hesitations and a lip smack included, approving the draft and
 * suggesting its own rewording. Nothing in the voice's prompt said it is never the owner, and the owner's own
 * words had just asked for "my voice". Repro: the segments of a recorded call turn, and the `held-answer` and
 * `resume` lines before it, in `$SLOPWEAVER_HOME/talk/calls/*.jsonl`.
 *
 * Both blocks are short because every byte is paid for under the prompts' budget (`promptBytes.test.ts`): each
 * sentence holds one property, and WHETHER a draft is read, a card's draft and an id stay with the lines that own
 * them. The question line quotes no question: the console's own landed line, quoted in the voice's prompt, became
 * how about ten turns ended with no offer made (held by `sessionConfig.test.ts`).
 *
 * Whether the realtime model follows these is the real call's, `desktop e2e --call --only draft-read-back`
 * (`src/desktop/e2eCallPlan.ts`), read off the call file afterwards.
 */

/**
 * The voice's paragraph: it speaks only as itself, and a draft of the owner's words is quoted, never performed. "A draft's words
 * aside" is what keeps it satisfiable beside the card-draft line's "word for word": a draft that itself says "Um, yeah"
 * is read as written, and the ban is on the voice adding the owner's register of its own.
 * The owner's energy is set aside where it is asked for: the persona (`./sessionConfig.ts`) and the delivery line
 * (`./spokenLengthLines.ts`) each match it "bar a quote", and the copy-offer line reads a draft "evenly as a quote", so
 * an angry dictation read back is never the owner again.
 */
export const QUOTED_DRAFT_VOICE_LINES: readonly string[] = [
  "Never be the owner, even 'in my voice': a draft's words aside, never their register (um), answer or reaction.",
];

/**
 * The thinking model's bullet: the frame around a draft read aloud is written INTO its answer, since the voice says a
 * handed-back answer and stops, adding nothing of its own (`./handedBackAnswerLines.ts`). A card's draft keeps its
 * own block's "nothing before or after" (`./openCardDraftLines.ts`), and one the owner asks to change stays the draft-edit
 * bullet's, never in the answer even with a read-back asked beside it; a card draft the owner asks only to
 * hear goes as its own rule says, the open-card block's or, on a card opened this turn with none, read_card's,
 * while one asked beside another question is framed here like any draft. "Any id in words" keeps "whole" satisfiable
 * beside the id rule (`./spokenClaimLines.ts`): a draft carrying a
 * commit hash is still answered, the hash named as that rule says. "Anyway, past one
 * short line" overrides the copy-offer bullet just above, its "never into your answer" and "at most one short line",
 * which "draft this and read it back" otherwise meets both at once.
 */
export const QUOTED_DRAFT_BACKEND_LINES: readonly string[] = [
  "- A draft the owner asks to hear goes in your answer anyway, past one short line, whole, any id in words: 'The draft",
  "  says:', its words, 'That's the draft.' (a card's asked only to hear: as its rule says; never draft-edit's). Never answer or react for the owner.",
];
