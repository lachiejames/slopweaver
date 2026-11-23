/**
 * What the relay's typed line says the owner's words answered (`./supervisorDelivery.ts`): the verdict and where the
 * voice's turn is ride always, and the voice's own words are quoted in the room the owner's words leave. A bare
 * yes read without the "Needs more info here too?" it answered is how the chair approved a draft the owner had sent back.
 */
import { ANSWERED_VOICE_CHARS, type AnswerContext, compactVerdictClause, quotedVoice } from "./answerContext.js";

/**
 * The most of a slug, and of the voice turn's pointer, the line names. A minted slug is 17 characters and a minted
 * pointer about 75, so neither is ever cut; only a hand-edited record reaches these, and a field no budget below could
 * shrink would otherwise carry the line past its bound with the owner's words and the question gone. With both capped, every part but the owner's words, the voice's quote and the call's quotes is bounded, and those
 * three take only the room left.
 */
export const LINE_SLUG_CHARS = 40;
const LINE_POINTER_CHARS = 96;

/**
 * The most of why no voice turn is named the line carries: enough for every reason this repo writes for one turn, so
 * the line says why rather than only that. A line with no other room left carries the shorter cut,
 * which still holds a tail-only turn's whole reason (83 characters) so that one is always said.
 */
const LINE_WHY_CHARS = 160;
const LINE_SHORT_WHY_CHARS = 88;

/** The fewest characters of the voice's turn the line quotes; any less and it names the turn by its pointer alone. */
const MIN_VOICE_QUOTE = 24;

/**
 * Text as it may be typed into a terminal: every control character — an Escape, a Ctrl-C, a Ctrl-U, a DEL —
 * becomes a space, because the surface delivers bytes and a terminal reads some of them as KEYS: one could
 * interrupt the chair's running turn or clear the owner's composer, the two things this sender promises never to do.
 *
 * @returns the text with every control character a space
 */
export function typeable({ text }: { text: string }): string {
  return text.replaceAll(/\p{Cc}/gu, " ");
}

/**
 * A field as the line names it: whole, or cut at `max` characters and marked.
 *
 * @param max the most characters the field takes, its cut mark included
 * @returns the field, typeable
 */
export function cutField({ max, text }: { max: number; text: string }): string {
  const typed = typeable({ text });
  return typed.length <= max ? typed : `${typed.slice(0, max - 1)}…`;
}

/**
 * What the line says the owner's words answered: a fixed clause that always rides — the verdict, and where the voice's turn
 * is — and the voice's own words quoted in place of the pointer-only form when the room left holds them.
 *
 * @param answer what the owner's words answered
 * @param typed whether the owner typed the steer on the console, where no voice turn preceded it and only the verdict rides
 * @returns the fixed clause, the clause with the voice's turn quoted in at most `room` characters, and the shortest
 *   form — the reason no voice turn was named cut shorter — for a line with no other room left
 */
export function answerClause({ answer, typed }: { answer: AnswerContext; typed: boolean }): {
  fixed: string;
  quoted: (args: { room: number }) => string;
  short: string;
} {
  const triage =
    answer.triage.kind === "not-recorded"
      ? { ...answer.triage, slug: cutField({ max: LINE_SLUG_CHARS, text: answer.triage.slug }) }
      : answer.triage;
  const verdict = compactVerdictClause({ triage });
  const { voice } = answer;
  if (typed) {
    return { fixed: ` — ${verdict}`, quoted: () => ` — ${verdict}`, short: ` — ${verdict}` };
  }
  if (voice.kind !== "found") {
    const state = voice.kind === "not-found" ? "was not found" : "could not be read";
    const why = cutField({ max: LINE_WHY_CHARS, text: voice.why });
    const fixed = ` — the voice turn the owner answered ${state} (${why}); ${verdict}`;
    const shortWhy = cutField({ max: LINE_SHORT_WHY_CHARS, text: voice.why });
    return {
      fixed,
      quoted: () => fixed,
      short: ` — the voice turn the owner answered ${state} (${shortWhy}); ${verdict}`,
    };
  }
  const pointer = cutField({ max: LINE_POINTER_CHARS, text: voice.turn.pointer });
  const fixed = ` — answering the voice's turn ${pointer}; ${verdict}`;
  const quoted = ({ room }: { room: number }): string => {
    const overhead = ` — answering the voice's "" (${pointer}); ${verdict}`.length;
    const chars = Math.min(ANSWERED_VOICE_CHARS, room - overhead);
    if (chars < MIN_VOICE_QUOTE) {
      return fixed;
    }
    const quote = quotedVoice({ chars, text: typeable({ text: voice.turn.text }) });
    return ` — answering the voice's "${quote}" (${pointer}); ${verdict}`;
  };
  return { fixed, quoted, short: fixed };
}
