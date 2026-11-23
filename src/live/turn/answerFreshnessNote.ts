/**
 * Putting the door's freshness note ONTO the answer it is about — the last step of the thread-delta fix
 * (`./threadFreshness.ts`, whose header carries the incident).
 *
 * ## Why the door does this and not the author
 *
 * An author that words its own staleness disclaimer words it differently every turn, and one that is having
 * a bad turn omits it. The note is the door's own observation about the send, so the door composes it and
 * the door attaches it — there is no field an answer form can set to forge one, and none it can leave out.
 *
 * ## Why the FOLD and not the index
 *
 * Rule 7's cap is on what appears above the fold, and it is a hard cap. A freshness caveat that displaced a
 * substantive index row would make the answer worse in exchange for a footnote. `body` has no hard maximum
 * — an over-count is refused by `truncateAnswerForm` rather than silently trimmed — so a prepended block
 * cannot quietly drop a real one, and a form pushed past the cap fails loudly, which is correct.
 *
 * ## The ONE call site, and why it cannot move
 *
 * A verdict binds itself to the digest of the answer as PARSED (`../../admit/reviewVerdict.ts`), and
 * `./posterAnswer.ts` takes that digest with `answerDigestOf({ answer })` when it composes
 * `answerQualityGate` — INSIDE the door, not before it. So this runs at exactly one point: the
 * `renderAssistantAnswer` call in `postAnswerThroughDoor`'s `perform`, which is the only place strictly
 * after the gate has hashed the answer.
 *
 * Measured, on this change's own first draft: injecting the note in `turn answer` before `answerMention`
 * meant the door hashed the NOTED answer, the digest never matched the verdict, and every send carrying a
 * note was refused — the fix's happy path could not post at all. That is why the note is a poster-level
 * input beside `verdict` rather than something the answer carries: it is a fact about the SEND, and the
 * answer's bytes are the reviewer's.
 *
 * Pure: an answer and a line in, a new answer out.
 */
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";

/**
 * The answer as it should be posted, carrying the door's freshness note when there is one.
 *
 * @param answer the parsed answer form, exactly as the reviewer's verdict bound it
 * @param freshnessNote the door-composed line, absent when the thread did not move under this answer
 * @returns the answer to post — the same value when there is no note
 */
export function answerCarrying({
  answer,
  freshnessNote,
}: {
  answer: AnswerFormAnswer;
  freshnessNote: string | undefined;
}): AnswerFormAnswer {
  if (freshnessNote === undefined) {
    return answer;
  }
  return {
    ...answer,
    body: [{ runs: [{ text: freshnessNote, type: "text" }], type: "paragraph" }, ...answer.body],
  };
}
