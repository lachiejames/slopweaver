/**
 * The five MARKS a hand step may carry beside its sentence — which console it belongs to, whether it is a
 * check-in, whether it is a notice, whether it STOPS the owner's work, and which board row it waits on — each checked as a
 * stated value or as honestly absent.
 *
 * Its own module because `./step.ts` is the record and every rule about its sentence, and these four are
 * the fields a surface switches on rather than reads: the console by context, the ranking by check-in, every
 * waiting-on-the-owner list by notice (`./step.ts`'s `waitingHandSteps`), the evidence reader (`./evidence.ts`) by row. `unknown` in throughout, because a register line reaches them
 * unchecked, and a present value of the wrong kind is a corrupt line rather than an absent field.
 */
import { isSafeSlug } from "../handover/runStore.js";
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandContext, HandStep, HandStepDraft } from "./step.js";

/** How long a named board row's slug may be. The run store's own filename bound, well past every slug on the board. */
const ROW_CAP = 200;

/**
 * The step's stated context, checked as one of the console's two ids — or as honestly absent.
 *
 * Absence and a stated value are DIFFERENT postings, so the empty string is refused rather than folded into
 * absence: `--context ""` is a caller that meant to say something and said nothing, and silently reading it
 * as "did not say" is the fallback `no-silent-fallback` exists to stop. Anything that is not a string at all
 * is a corrupt register line, and it is named as such rather than dropped.
 *
 * @param value whatever the caller or the register line carried
 * @returns the context, `undefined` when the field was absent, or the refusal
 */
function checkedContext({ value }: { value: unknown }): Result<HandContext | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (value === "slopweaver" || value === "work") {
    return ok(value);
  }
  return err(
    HandStepErrors.invalidField({
      field: "context",
      why: "is `slopweaver` or `work` and nothing else — the console switches on those two ids, and a third value would be a row it silently could not place. Leave it off entirely for a step that belongs to neither",
    }),
  );
}

/**
 * The poster's check-in word, checked as `true` or honestly absent.
 *
 * `false` is refused rather than folded into absence for the reason {@link checkedContext} gives: nothing
 * writes it, so a line carrying it is not a line this register wrote.
 *
 * @param value whatever the caller or the register line carried
 * @returns `true`, `undefined` when the field was absent, or the refusal
 */
function checkedCheckIn({ value }: { value: unknown }): Result<true | undefined, HandStepError> {
  if (value === undefined || value === true) {
    return ok(value);
  }
  return err(
    HandStepErrors.invalidField({
      field: "checkIn",
      why: "is `true` or absent — `hand post --check-in` is the only thing that writes it",
    }),
  );
}

/**
 * The poster's word that a step is a NOTICE, checked as `true` or honestly absent — `false` refused for
 * {@link checkedCheckIn}'s reason: nothing writes it.
 *
 * @param value whatever the caller or the register line carried
 * @returns `true`, `undefined` when the field was absent, or the refusal
 */
function checkedNotice({ value }: { value: unknown }): Result<true | undefined, HandStepError> {
  if (value === undefined || value === true) {
    return ok(value);
  }
  return err(
    HandStepErrors.invalidField({
      field: "notice",
      why: "is `true` or absent — the monitor lane's informational notes are the only thing that writes it",
    }),
  );
}

/**
 * The poster's word that a step STOPS the owner's work, checked as `true` or honestly absent — `false` refused for
 * {@link checkedCheckIn}'s reason: nothing writes it.
 *
 * @param value whatever the caller or the register line carried
 * @returns `true`, `undefined` when the field was absent, or the refusal
 */
function checkedStopsWork({ value }: { value: unknown }): Result<true | undefined, HandStepError> {
  if (value === undefined || value === true) {
    return ok(value);
  }
  return err(
    HandStepErrors.invalidField({
      field: "stopsWork",
      why: "is `true` or absent — a monitor whose registry entry declares `stopsWork` is the only thing that writes it",
    }),
  );
}

/**
 * The board row a step names, checked as a slug the run store could open — the same `isSafeSlug` rule every
 * run verb and `handover row` hold, so a named row is one the evidence reader can actually read.
 *
 * `unknown` in, because a register line reaches this unchecked: a present non-string REFUSES rather than
 * reading as a step that names no row, which would quietly switch its evidence retraction off.
 *
 * @param value the raw field
 * @returns the slug, `undefined` when absent, or the refusal
 */
function checkedRow({ value }: { value: unknown }): Result<string | undefined, HandStepError> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || !isSafeSlug({ slug: value }) || value.length > ROW_CAP) {
    return err(
      HandStepErrors.invalidField({
        field: "row",
        why: `is not a board-row slug — letters, digits, dots, hyphens and underscores, at most ${String(ROW_CAP)} characters`,
      }),
    );
  }
  return ok(value);
}

/**
 * The five marks, checked in the order a refusal names them, and only the ones the draft carried.
 *
 * @param draft every field as the caller has it
 * @returns the marks that were supplied, or the first refusal
 */
export function checkedMarks({
  draft,
}: {
  draft: HandStepDraft;
}): Result<Pick<HandStep, "context" | "checkIn" | "notice" | "row" | "stopsWork">, HandStepError> {
  const context = checkedContext({ value: draft.context });
  if (context.isErr()) {
    return err(context.error);
  }
  const checkIn = checkedCheckIn({ value: draft.checkIn });
  if (checkIn.isErr()) {
    return err(checkIn.error);
  }
  const notice = checkedNotice({ value: draft.notice });
  if (notice.isErr()) {
    return err(notice.error);
  }
  const stopsWork = checkedStopsWork({ value: draft.stopsWork });
  if (stopsWork.isErr()) {
    return err(stopsWork.error);
  }
  const row = checkedRow({ value: draft.row });
  if (row.isErr()) {
    return err(row.error);
  }
  return ok({
    ...(row.value === undefined ? {} : { row: row.value }),
    ...(checkIn.value === undefined ? {} : { checkIn: checkIn.value }),
    ...(notice.value === undefined ? {} : { notice: notice.value }),
    ...(context.value === undefined ? {} : { context: context.value }),
    ...(stopsWork.value === undefined ? {} : { stopsWork: stopsWork.value }),
  });
}

/**
 * The checked marks as one piece per field, each empty when absent — so a builder can spread each at its own
 * place in the register line's key order without a conditional per field.
 *
 * @param marks what {@link checkedMarks} returned
 * @returns a spreadable piece per mark
 */
export function markPieces({
  marks,
}: {
  marks: Pick<HandStep, "context" | "checkIn" | "notice" | "row" | "stopsWork">;
}): {
  readonly checkIn: Pick<HandStep, "checkIn">;
  readonly context: Pick<HandStep, "context">;
  readonly notice: Pick<HandStep, "notice">;
  readonly row: Pick<HandStep, "row">;
  readonly stopsWork: Pick<HandStep, "stopsWork">;
} {
  const { checkIn, context, notice, row, stopsWork } = marks;
  return {
    checkIn: checkIn === undefined ? {} : { checkIn },
    context: context === undefined ? {} : { context },
    notice: notice === undefined ? {} : { notice },
    row: row === undefined ? {} : { row },
    stopsWork: stopsWork === undefined ? {} : { stopsWork },
  };
}
