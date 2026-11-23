/**
 * The picture an open ask's card shows, with a box on the part the owner is meant to read — `handover shot`.
 *
 * A bare screenshot leaves it unclear which part to look at, so an annotation, such as a red box around the
 * stale or missing item, says where. And a card that names an image file as text instead of showing it hides the
 * picture: if there is an image, the owner sees it on the queue card.
 *
 * So an ask carries a picture exactly as a hand step does (`../hand/shot.ts`): the PNG stored once by its SHA-256 in
 * the same store, its natural size, and ONE TO NINE labelled boxes in image pixels — a picture with no box is refused
 * at the write, because the box is the point. The console draws it with the same overlay a hand step's uses.
 *
 * Two homes, one per row shape, as `./askExamples.ts`'s scenes have: a run parked on the owner takes a `question-shot`
 * journal line bound to the open question's exact text, so a re-ask or reshape leaves the old picture behind; a
 * registered ask with no run takes `shot:` in its front matter. A later one replaces an earlier one whole.
 *
 * Pure: no I/O.
 */
import { z } from "zod";

import { checkedShot, type HandShot } from "../hand/shot.js";

import type { RunEvent } from "./ledger.js";
import { optionalText } from "./ledgerFields.js";

/**
 * The open question's PICTURE as a journal line. Not a re-ask: the text and the asked instant stay where they were.
 * One arm of `./ledger.ts`'s `RunEvent`, declared here beside the rules it obeys.
 */
export interface QuestionShotEvent {
  readonly kind: "question-shot";
  readonly atIso: string;
  readonly question: string;
  readonly shot: HandShot;
}

/**
 * Decode a question's picture, whole or nothing: a line whose picture does not read decodes to no event rather than
 * to one that would clear the picture an earlier line recorded, and a box past its picture is never drawn.
 *
 * @returns the event, or `undefined` when the line carries no question or no picture that reads
 */
export function questionShotEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const question = optionalText({ key: "question", payload });
  const shot = askShotOf({ value: payload["shot"] });
  if (question === undefined || shot === undefined) {
    return undefined;
  }
  return { atIso, kind: "question-shot", question, shot };
}

/**
 * A recorded picture read whole, or `undefined` when it is absent or does not read.
 *
 * @param value the raw `shot` field off a journal line or a doc's front matter
 * @returns the picture, or `undefined`
 */
export function askShotOf({ value }: { value: unknown }): HandShot | undefined {
  const checked = checkedShot({ unboxed: "refused", value });
  return checked.isOk() ? checked.value : undefined;
}

/**
 * Every rule a picture about to be written breaks — the write schema's and the verb's one list.
 *
 * @param value the `shot` field about to be written
 * @returns one message per rule broken, empty when it reads
 */
export function askShotProblems({ value }: { value: unknown }): readonly string[] {
  if (value === undefined) {
    return ["shot is missing — a question-shot line carries the picture it attaches"];
  }
  const checked = checkedShot({ unboxed: "refused", value });
  return checked.isErr() ? [checked.error.message] : [];
}

/**
 * The write schema's `shot` field on a `question-shot` line — {@link askShotProblems} as one Zod field, so the verb,
 * the store and the console's reader cannot disagree about what a boxed picture is.
 */
export const askShotSchema = z.unknown().superRefine((value, context) => {
  for (const problem of askShotProblems({ value })) {
    context.addIssue({ code: "custom", message: problem });
  }
});

/**
 * Whether two pictures are the same picture with the same boxes — so a re-run writes nothing.
 *
 * @param left one picture, or none
 * @param right the other, or none
 * @returns true when both are absent, or both name the same bytes with the same boxes in the same order
 */
export function sameAskShot({ left, right }: { left: HandShot | undefined; right: HandShot | undefined }): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    left.sha256 === right.sha256 &&
    left.width === right.width &&
    left.height === right.height &&
    left.boxes.length === right.boxes.length &&
    left.boxes.every((box, index) => {
      const other = right.boxes[index]!;
      return (
        box.x === other.x &&
        box.y === other.y &&
        box.width === other.width &&
        box.height === other.height &&
        box.label === other.label
      );
    })
  );
}
