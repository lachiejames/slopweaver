/*
 * The disclosure under a queue card, as a shape that CANNOT draw a wall of text unasked.
 *
 * Expanding "the rest of what the record says" must never give the owner a wall of text. The fix is not
 * shorter prose — a register's field is whatever the verb wrote — so it is a type: a disclosure is a list of
 * short LABELLED lines, and a value past the cap becomes a `folded` line whose `head` fits the cap and whose
 * `whole` is drawn only when the owner presses "show all". That is `AGENTS.md` rule 7's progressive disclosure written as a type: the head is the
 * one text drawn unasked, and `fleet-briefing-shape.md` § "The page never truncates" holds from the other
 * side — nothing is ever cut, the whole field is one press away.
 *
 * An over-cap field never prints a notice in place of itself: a page the owner chose to expand shows the content,
 * and only an OUTBOUND form refuses a violation.
 *
 * Imports nothing, like `./queueCard.ts` beside it, so the root unit lane reaches it.
 */

/**
 * The longest a disclosure line may run unasked, in characters.
 *
 * MEASURED over the board rows that were actually waiting on the owner's word — repro:
 * `slopweaver handover list --json`, keep the rows whose `ownerWait` is none of `not-waiting`, `settled`, `already-ruled` and `not-runnable` and carry a `question`, and measure
 * each whole question against its own first sentence. Twenty-one rows: the whole questions ran 448 to
 * 1562 characters (p50 1125), their first sentences 29 to 221 (p50 89). The gap between 221 and 448 is
 * empty, so a cap anywhere inside it keeps every lead sentence visible and folds every wall behind a press.
 * 240 sits in that gap with room on both sides.
 */
export const LINE_MAX_CHARS = 240;

/** Where one sentence ends and the next begins — `sentencesOf` in `./queueCard.ts`, kept local so this file imports nothing. */
const SENTENCE_BREAK = /(?<=[.!?])\s+/u;

/**
 * One line of a record disclosure.
 *
 * `value` carries text that FIT; `folded` carries text that did not, as the `head` drawn unasked and the
 * `whole` drawn only once the owner presses "show all".
 */
export type RecordLine =
  | { readonly kind: "value"; readonly label: string; readonly value: string }
  | { readonly kind: "link"; readonly label: string; readonly text: string; readonly url: string }
  | { readonly kind: "absent"; readonly label: string; readonly why: string }
  | {
      readonly kind: "folded";
      readonly label: string;
      /** At most {@link LINE_MAX_CHARS}: whole leading sentences, or the words of a first sentence that fit. */
      readonly head: string;
      /** The field whole, whitespace collapsed — drawn only after "show all". */
      readonly whole: string;
    };

/**
 * The part of an over-cap text drawn unasked: whole leading sentences while they fit, else the words of the
 * first sentence that fit — never mid-word, never with an ellipsis, and the empty string when not even the
 * first word fits.
 *
 * @param whole the whitespace-collapsed field, already known to run past the cap
 * @returns the head, at most {@link LINE_MAX_CHARS} characters
 */
function headOf({ whole }: { whole: string }): string {
  let head = "";
  for (const sentence of whole.split(SENTENCE_BREAK)) {
    const next = head.length === 0 ? sentence : `${head} ${sentence}`;
    if (next.length > LINE_MAX_CHARS) {
      break;
    }
    head = next;
  }
  if (head.length > 0) {
    return head;
  }
  for (const word of whole.split(" ")) {
    const next = head.length === 0 ? word : `${head} ${word}`;
    if (next.length > LINE_MAX_CHARS) {
      break;
    }
    head = next;
  }
  return head;
}

/**
 * The line for a text past the cap — the one place `folded` is built, so a value and a link label fold alike.
 *
 * @param label the field's own name
 * @param whole the whitespace-collapsed field
 * @returns the folded line
 */
function foldedLine({ label, whole }: { label: string; whole: string }): RecordLine {
  return { head: headOf({ whole }), kind: "folded", label, whole };
}

/**
 * One labelled line for a field the record carries.
 *
 * The ONE constructor for a text line, so the cap cannot be reached around: a value past
 * {@link LINE_MAX_CHARS} comes back `folded`, its head drawn and the whole behind "show all".
 *
 * @param label the field's own name, as the register calls it
 * @param value the field exactly as the verb wrote it
 * @returns the line
 */
export function recordLine({ label, value }: { label: string; value: string }): RecordLine {
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length > LINE_MAX_CHARS) {
    return foldedLine({ label, whole: text });
  }
  return { kind: "value", label, value: text };
}

/**
 * One labelled line for a field the record does NOT carry.
 *
 * Separate from an empty `value` on purpose, and it keeps the `said({ absent })` discipline these panels
 * already use: a field the register never wrote says so, rather than rendering as a gap a reader reads as
 * a bug. The sentence is measured like any value, so no arm draws past the cap unasked.
 *
 * @param label the field's own name
 * @param why what the register says instead
 * @returns the line
 */
export function recordAbsent({ label, why }: { label: string; why: string }): RecordLine {
  const said = why.replace(/\s+/gu, " ").trim();
  if (said.length > LINE_MAX_CHARS) {
    return foldedLine({ label, whole: said });
  }
  return { kind: "absent", label, why: said };
}

/**
 * One labelled line whose value is an address, drawn as a link rather than printed.
 *
 * The ADDRESS is never measured — a 300-character permalink is one click, not a wall, and the page draws
 * the label rather than the characters. The LABEL is measured exactly as a value is, because a label is
 * text a register wrote and nothing guarantees it is short: `subjectLabel` falls through to the raw
 * subject for anything that is not a GitHub pull or a Slack archive URL. Review pass r1
 * (no-wall-reaches-the-page) found this as the one constructor that measured nothing, which is why it is
 * spelled out here — on the register as it stands the branch is unreachable (680 act subjects, max 126
 * characters, `slopweaver autonomy list --json`), and that is a fact about the DATA. Rule 7 asks the
 * schema to hold, not the data to behave. An over-cap label folds as a value does, and is drawn as text.
 *
 * @param label the field's own name
 * @param text the short label the link is drawn as
 * @param url the address itself
 * @returns the line
 */
export function recordLink({ label, text, url }: { label: string; text: string; url: string }): RecordLine {
  const drawn = text.replace(/\s+/gu, " ").trim();
  if (drawn.length > LINE_MAX_CHARS) {
    return foldedLine({ label, whole: drawn });
  }
  return { kind: "link", label, text: drawn, url };
}

/**
 * A line for a field the record may not carry: the value when it is there, the stated absence when it is not.
 *
 * @param label the field's own name
 * @param value the field, or nothing
 * @param absent what to say when the register did not write it
 * @returns the line
 */
export function recordMaybe({
  label,
  value,
  absent,
}: {
  label: string;
  value: string | undefined;
  absent: string;
}): RecordLine {
  if (value === undefined) {
    return recordAbsent({ label, why: absent });
  }
  return recordLine({ label, value });
}
