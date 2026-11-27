/**
 * Every way the C3 description core refuses: a badge it cannot derive, or a body it cannot read back.
 *
 * One union for the module because every caller treats them alike — it prints `message` and, at most, branches on
 * `PRE_C3_SHAPE` to name the conversion. A union shared with any other domain would be wrong
 * (`.claude/rules/error-handling.md`).
 */

/** The conversion every pre-C3 body is pointed at: it writes an authoring file and sends nothing. */
export const PRE_C3_CONVERSION =
  "slopweaver github pr update <owner/repo#n> --pull --convert-c3 --out <file>, then --file <file>";

/** A day field that is not a real `YYYY-MM-DD` calendar day. */
export interface InvalidDayError {
  readonly code: "INVALID_DAY";
  readonly message: string;
  readonly field: string;
  readonly value: string;
}

/** The problem was "seen" on a day after the day of the write. */
export interface SeenAfterTodayError {
  readonly code: "SEEN_AFTER_TODAY";
  readonly message: string;
  readonly on: string;
  readonly today: string;
}

/** Risk items empty, or ranked out of order. */
export interface RiskUnrankedError {
  readonly code: "RISK_UNRANKED";
  readonly message: string;
}

/** A derived badge hover is longer than a reader is reliably shown. */
export interface HoverTooLongError {
  readonly code: "HOVER_TOO_LONG";
  readonly message: string;
  readonly badge: string;
  readonly length: number;
}

/** There is no body to read. */
export interface AbsentBodyError {
  readonly code: "ABSENT_BODY";
  readonly message: string;
}

/** The body is a pre-C3 shape (reading-order or the retired table), which converts through its own verb. */
export interface PreC3ShapeError {
  readonly code: "PRE_C3_SHAPE";
  readonly message: string;
  readonly conversion: string;
}

/** The body is not in the renderer's block structure. */
export interface StructureError {
  readonly code: "STRUCTURE";
  readonly message: string;
  /** Which block the reading stopped at. */
  readonly at: string;
}

/** A recovered form is not one the schema accepts. */
export interface RecoveredSchemaError {
  readonly code: "RECOVERED_SCHEMA";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Re-rendering the recovered form does not reproduce the bytes it came from. */
export interface NonCanonicalError {
  readonly code: "NON_CANONICAL";
  readonly message: string;
}

/** Content after the rendered body carries markup only the renderer emits, or could continue an open checks run. */
export interface TrailingMarkupError {
  readonly code: "TRAILING_MARKUP";
  readonly message: string;
}

/** Every C3 description refusal. */
export type PrBodyError =
  | InvalidDayError
  | SeenAfterTodayError
  | RiskUnrankedError
  | HoverTooLongError
  | AbsentBodyError
  | PreC3ShapeError
  | StructureError
  | RecoveredSchemaError
  | NonCanonicalError
  | TrailingMarkupError;

/** The factory every {@link PrBodyError} is built through. */
export const PrBodyErrors = {
  absentBody: (): AbsentBodyError => ({
    code: "ABSENT_BODY",
    message: "the pull request has no description, so there is no form to recover from it",
  }),
  hoverTooLong: ({ badge, length, max }: { badge: string; length: number; max: number }): HoverTooLongError => ({
    badge,
    code: "HOVER_TOO_LONG",
    length,
    message:
      `the ${badge} badge's hover would be ${String(length)} characters (max ${String(max)}), and a longer one is cut ` +
      "off where a reader hovers. Shorten the field it is built from",
  }),
  invalidDay: ({ field, value }: { field: string; value: string }): InvalidDayError => ({
    code: "INVALID_DAY",
    field,
    message: `${field} is "${value}", which is not a real YYYY-MM-DD calendar day`,
    value,
  }),
  nonCanonical: (): NonCanonicalError => ({
    code: "NON_CANONICAL",
    message:
      "re-rendering the recovered form does not reproduce the description byte for byte, so the reading is not " +
      "trustworthy. Rewrite it whole with a complete --form or --file",
  }),
  preC3Shape: ({ shape }: { shape: string }): PreC3ShapeError => ({
    code: "PRE_C3_SHAPE",
    conversion: PRE_C3_CONVERSION,
    message:
      `this description is the ${shape} shape, written before the C3 form. It converts through its own verb, which ` +
      `writes an authoring file and a report of what it dropped and sends nothing: \`${PRE_C3_CONVERSION}\``,
  }),
  recoveredSchema: ({ issues }: { issues: readonly string[] }): RecoveredSchemaError => ({
    code: "RECOVERED_SCHEMA",
    issues,
    message: `the recovered form is not valid: ${issues.join("; ")}`,
  }),
  riskUnranked: ({ detail }: { detail: string }): RiskUnrankedError => ({
    code: "RISK_UNRANKED",
    message: `the risk items cannot be ranked: ${detail}`,
  }),
  seenAfterToday: ({ on, today }: { on: string; today: string }): SeenAfterTodayError => ({
    code: "SEEN_AFTER_TODAY",
    message: `the problem is marked seen on ${on}, after today (${today}). A problem seen today is seen today, never later`,
    on,
    today,
  }),
  structure: ({ at }: { at: string }): StructureError => ({
    at,
    code: "STRUCTURE",
    message:
      `the description is not in the C3 shape this renderer emits (stopped at: ${at}). Rewrite it whole with a ` +
      "complete --form or --file",
  }),
  trailingMarkup: (): TrailingMarkupError => ({
    code: "TRAILING_MARKUP",
    message:
      "content follows the rendered description and itself carries markup only the renderer emits — a badge, a " +
      "proof heading or the re-run fold, or a check paragraph's `<p>` or `</p>` after a layout-1 description ending on its " +
      "checks, which may be a check displaced by something inserted before it. Preserving it verbatim would leave " +
      "two of them standing. Refusing to guess",
  }),
} as const;
