/**
 * Decoding the QUESTION lines, split out of `./ledger.ts` the way `./rulingLineDecode.ts` was.
 *
 * A real seam rather than a size dodge: `./ledger.ts` answers what a journal line IS, and both functions
 * here answer the one question the ask family asks that no other kind does — which of its OPTIONAL halves
 * the line actually declared. The write side of the same contract is `./rowEventSchema.ts`, the shape those
 * halves have to hold is `./askShape.ts`, and the handle a post produces is `./questionPost.ts`.
 *
 * **An ACTION's options are DERIVED here, and the line's own `options` are not read at all.** The verbs
 * already refuse `--options` beside `--action`, but a write-side refusal only binds the verbs: the journal
 * is a file, and a line carrying an action beside an unrelated option list parses perfectly and reads as a
 * card offering to DM someone over a draft addressed to a channel. Deriving on the way IN makes the
 * stored copy inert, so the two can no longer disagree whoever wrote the line.
 *
 * **The one property both functions hold: an absent field is OMITTED, never set to `undefined`.**
 * `./rowEvent.ts` compares its own append to what the file parses back to, so a manufactured `problem:
 * undefined` disappears through `JSON.stringify` on the way out and would not return — failing a write that
 * was correct. `exactOptionalPropertyTypes` is what makes the two states distinguishable, and a card reads
 * exactly that distinction to decide whether to draw its "needs rewriting" mark.
 *
 * Pure: no filesystem, no clock.
 */
import { actionOptions } from "./askActionOptions.js";
import { askActionFrom } from "./askActionWire.js";
import { type AskOption, askOptionsFrom, askStakesFrom } from "./askShape.js";
import type { RunEvent } from "./ledger.js";
import { optionalText, stringList, text } from "./ledgerFields.js";

/**
 * The options a question really offers, over all three arms of {@link askActionFrom}.
 *
 * `none` is the ordinary ask: it carries the two-to-four it was authored with, the shape the owner's ruling
 * requires and this one does not replace. `action` derives them.
 *
 * **`invalid` carries NONE of them, and that arm is the whole point.** A line whose action is present and
 * will not read is not a line with no action — the stored list was written to describe destinations, so
 * handing it back over a dropped action prints "DM Tobias" on a card whose draft was addressed to a channel
 * and no longer reads at all. A card with no options draws its "needs rewriting" mark; a card with the
 * wrong ones draws a decision.
 */
function optionsOf({
  action,
  payload,
}: {
  action: ReturnType<typeof askActionFrom>;
  payload: Readonly<Record<string, unknown>>;
}): readonly AskOption[] {
  if (action.kind === "action") {
    return actionOptions({ action: action.action });
  }
  if (action.kind === "invalid") {
    return [];
  }
  return askOptionsFrom({ value: payload["options"] });
}

/**
 * Decode a recorded question, carrying each half of its shape only when the line has one.
 *
 * The shape is mandatory at the VERB and optional here, and the asymmetry is deliberate: questions were
 * already journalled as free text when the owner's ruling requiring a shape was made, and an older line has to keep
 * reading. A card renders the absence as a visible mark rather than as a gap.
 *
 * @returns the event, with `problem`, `options` and `lean` present only where the line declared them, and
 *   `options` DERIVED from the action on a line that carries one
 */
export function questionEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent {
  const problem = optionalText({ key: "problem", payload });
  const lean = optionalText({ key: "lean", payload });
  const action = askActionFrom({ value: payload["action"] });
  const options = optionsOf({ action, payload });
  const stakes = askStakesFrom({ value: payload["stakes"] });
  return {
    ...(action.kind === "action" ? { action: action.action } : {}),
    // The broken draft leaves a MARK rather than nothing: erasing it made the row indistinguishable from
    // one that never offered a draft, and the publisher's doc fallback then restored the very options this
    // function had just dropped. See the field's own contract on `RunEvent`.
    ...(action.kind === "invalid" ? { actionUnreadable: true as const } : {}),
    atIso,
    kind: "question",
    ...(lean === undefined ? {} : { lean }),
    ...(options.length === 0 ? {} : { options }),
    ...(problem === undefined ? {} : { problem }),
    question: text({ key: "question", payload }),
    ...(stakes === undefined ? {} : { stakes }),
    ...examplesFields({ payload }),
  };
}

/**
 * The concrete examples a question line carries beside its text — each half present only when the line declared
 * it, per this file's header, and blank scenes dropped as `questionExamplesEvent` drops them.
 */
function examplesFields({ payload }: { payload: Readonly<Record<string, unknown>> }): {
  readonly examples?: readonly string[];
  readonly exampleGap?: string;
} {
  const examples = stringList({ key: "examples", payload }).filter((scene) => scene.trim().length > 0);
  const exampleGap = optionalText({ key: "exampleGap", payload });
  return {
    ...(examples.length === 0 ? {} : { examples }),
    ...(exampleGap === undefined ? {} : { exampleGap }),
  };
}

/**
 * Decode an ACTION attached to a question already waiting — `handover offer`'s own line.
 *
 * Every field is REQUIRED here, unlike on a `question`: the kind did not exist before the action did, so
 * there is no older line to keep reading, and an offer missing half of what it replaces would leave a card
 * drawing one ask's problem over another's draft.
 *
 * A line whose action will not read is UNREADABLE rather than an offer with no action — the whole content
 * of this kind is the action, so half of one is damage, and `./ledger.ts`'s header says what an unreadable
 * line costs. The write schema is what guarantees no verb can produce one.
 *
 * Its options are DERIVED from that action and the line's own `options` are ignored, for the reason in this
 * file's header: the write side already refuses a hand-authored list, and reading one back would let a
 * hand-edited journal line put the owner's choice over a different message anyway.
 *
 * @returns the event, or `undefined` when the line's action will not read
 */
export function questionOfferedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const action = askActionFrom({ value: payload["action"] });
  if (action.kind !== "action") {
    return undefined;
  }
  const stakes = askStakesFrom({ value: payload["stakes"] });
  return {
    action: action.action,
    atIso,
    kind: "question-offered",
    lean: text({ key: "lean", payload }),
    options: actionOptions({ action: action.action }),
    problem: text({ key: "problem", payload }),
    question: text({ key: "question", payload }),
    ...(stakes === undefined ? {} : { stakes }),
  };
}

/**
 * Decode a SHAPE given to a question recorded without one — `handover ask` on a run waiting on an unshaped ask.
 *
 * Every field is REQUIRED, for `questionOfferedEvent`'s reason: the kind is younger than the shape, so there is no
 * older line to keep reading, and a reshape missing half of what it states is damage rather than a smaller reshape.
 * Such a line is UNREADABLE, never a reshape drawing two thirds of a card.
 *
 * @returns the event, or `undefined` when any field it replaces the held question with is absent
 */
export function questionShapedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const question = optionalText({ key: "question", payload });
  const replaces = optionalText({ key: "replaces", payload });
  const problem = optionalText({ key: "problem", payload });
  const lean = optionalText({ key: "lean", payload });
  const options = askOptionsFrom({ value: payload["options"] });
  const stakes = askStakesFrom({ value: payload["stakes"] });
  const whole = question !== undefined && replaces !== undefined && problem !== undefined && lean !== undefined;
  if (!whole || options.length === 0 || stakes === undefined) {
    return undefined;
  }
  return {
    atIso,
    kind: "question-shaped",
    lean,
    options,
    problem,
    question,
    replaces,
    stakes,
    ...examplesFields({ payload }),
  };
}

/**
 * Decode a posted handle, carrying its permalink only when the line has one.
 *
 * @returns the event, whose `permalink` is absent for a post whose workspace URL would not resolve
 */
export function questionPostedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent {
  const permalink = optionalText({ key: "permalink", payload });
  return {
    atIso,
    channel: text({ key: "channel", payload }),
    kind: "question-posted",
    ...(permalink === undefined ? {} : { permalink }),
    question: text({ key: "question", payload }),
    ts: text({ key: "ts", payload }),
  };
}

/**
 * Decode a reconfirm — the open question's text and the one-line check that re-confirmed it.
 *
 * @returns the event
 */
export function questionReconfirmedEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent {
  return {
    atIso,
    kind: "question-reconfirmed",
    question: text({ key: "question", payload }),
    stillReal: text({ key: "stillReal", payload }),
  };
}

/**
 * Decode a question's concrete examples — the scenes in order, or the gap line, bound to the question it names.
 *
 * Whole or nothing, as the shape is: a line carrying neither scenes nor a gap illustrates nothing, so it decodes to
 * no event rather than to one that would clear the examples an earlier line recorded.
 *
 * @returns the event, or `undefined` when the line carries no question or neither half
 */
export function questionExamplesEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const question = optionalText({ key: "question", payload });
  const examples = stringList({ key: "examples", payload }).filter((scene) => scene.trim().length > 0);
  const exampleGap = optionalText({ key: "exampleGap", payload });
  if (question === undefined || (examples.length === 0 && exampleGap === undefined)) {
    return undefined;
  }
  return {
    atIso,
    examples,
    ...(exampleGap === undefined ? {} : { exampleGap }),
    kind: "question-examples",
    question,
  };
}
