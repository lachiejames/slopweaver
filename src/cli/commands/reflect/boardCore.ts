/**
 * The PURE core of `slopweaver reflect board`: its usage line and its one flag spec. No fs, no clock —
 * `boardRun.ts` does every read and resolves `now`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";

/**
 * The one flag spec the verb parses with, exported so `helpTruth.test.ts` probes the REAL list rather than
 * a copy of it.
 *
 * @internal
 */
export const REFLECT_BOARD_FLAG_SPEC = {
  boolean: ["json"],
  value: ["now"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/**
 * The validated invocation for `reflect board`.
 *
 * @internal
 */
export interface ReflectBoardOptions {
  /** The instant to age every doc against. `undefined` means the caller's real clock. */
  readonly nowIso: string | undefined;
  readonly json: boolean;
}

/**
 * Parse `reflect board`'s flags.
 *
 * @param rest the argv tail (after `slopweaver reflect board`)
 * @returns the validated options, or every rejection
 */
export function parseReflectBoardOptions({ rest }: { rest: readonly string[] }): Result<ReflectBoardOptions> {
  const parsed = parseFlagTail({ rest, spec: REFLECT_BOARD_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  return ok({ json: flags.has("json"), nowIso: values["now"] });
}
