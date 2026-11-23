/**
 * Every way the pre-C3 reader refuses: a derivation it cannot make, or a body it cannot read back.
 *
 * The same pull-request description domain as `../errors.ts`, so every refusal the two readers share is that
 * module's own type and factory; only the three this reader words differently, and the two it alone raises, are
 * declared here. One union for the module because every caller treats them alike — it prints `message` and, at
 * most, branches on `RETIRED_SHAPE` to name the conversion (`.claude/rules/error-handling.md`).
 */

import {
  type AbsentBodyError,
  type InvalidDayError,
  type NonCanonicalError,
  PrBodyErrors,
  type RecoveredSchemaError,
  type RiskUnrankedError,
  type StructureError,
  type TrailingMarkupError,
} from "../errors.js";

/** The conversion every old-shape body is pointed at. */
export const RETIRED_SHAPE_CONVERSION = "slopweaver github pr update --repo <owner/name> --number <n> --file <f>";

/** The problem was "seen" on a day after the body was written. */
interface SeenAfterWrittenError {
  readonly code: "SEEN_AFTER_WRITTEN";
  readonly message: string;
  readonly on: string;
  readonly writtenOn: string;
}

/** The body is the retired table shape, which has no reading-order preimage. */
interface RetiredShapeError {
  readonly code: "RETIRED_SHAPE";
  readonly message: string;
  readonly conversion: string;
}

/** Every reading-order refusal. */
export type ReadingOrderError =
  | InvalidDayError
  | SeenAfterWrittenError
  | RiskUnrankedError
  | AbsentBodyError
  | RetiredShapeError
  | StructureError
  | RecoveredSchemaError
  | NonCanonicalError
  | TrailingMarkupError;

/** The factory every {@link ReadingOrderError} is built through. */
export const ReadingOrderErrors = {
  absentBody: PrBodyErrors.absentBody,
  invalidDay: PrBodyErrors.invalidDay,
  nonCanonical: PrBodyErrors.nonCanonical,
  recoveredSchema: PrBodyErrors.recoveredSchema,
  retiredShape: (): RetiredShapeError => ({
    code: "RETIRED_SHAPE",
    conversion: RETIRED_SHAPE_CONVERSION,
    message:
      "this description is the retired table shape (badge row, Next table, Problem/Solution/Proof), which has no " +
      `reading-order preimage. Convert it by replacing it whole: \`${RETIRED_SHAPE_CONVERSION}\``,
  }),
  riskUnranked: PrBodyErrors.riskUnranked,
  seenAfterWritten: ({ on, writtenOn }: { on: string; writtenOn: string }): SeenAfterWrittenError => ({
    code: "SEEN_AFTER_WRITTEN",
    message:
      `the problem is marked seen on ${on}, after the body was written on ${writtenOn}. A problem re-observed ` +
      "today is seen on the write day, never later",
    on,
    writtenOn,
  }),
  structure: ({ at }: { at: string }): StructureError => ({
    at,
    code: "STRUCTURE",
    message:
      `the description is not in the reading-order shape this renderer emits (stopped at: ${at}). Rewrite it ` +
      "whole with a complete --form or --file",
  }),
  trailingMarkup: (): TrailingMarkupError => ({
    code: "TRAILING_MARKUP",
    message:
      "content follows the rendered description and itself carries markup only a renderer emits — a heading, a " +
      "badge, a table or a proof anchor. Preserving it verbatim would leave two of them standing. Refusing to guess",
  }),
} as const;
