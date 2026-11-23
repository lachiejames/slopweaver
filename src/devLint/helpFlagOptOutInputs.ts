/**
 * The two committed inputs `help-flag-opt-out` (`./helpFlagOptOut.ts`) reads, and how each is read: `helpTruth`'s
 * `UNGUARDED` register, and the offender baseline. Both are pure text-in, value-out, and each failure is one
 * `DevLintInputError` (`./errors.ts`) the gate prints as a fact about its input rather than a verdict.
 */
import { z } from "zod";
import { parseJson } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";
import { type DevLintInputError, DevLintInputErrors } from "./errors.js";

/** The register of opt-outs this gate audits. */
export const HELP_TRUTH_TEST = "src/__tests__/unit/cli/helpTruth.test.ts";

/** The committed offender list, repo-relative. */
export const BASELINE_FILE = "help-flag-optout-baseline.json";

/** The line that opens `helpTruth`'s opt-out register. Its absence is a hard failure, never a clean scan. */
const UNGUARDED_OPENER = "const UNGUARDED: Readonly<Record<string, string>> = {";

/**
 * One verb's opt-out, as `helpTruth` records it.
 *
 * @internal
 */
export interface OptOut {
  /** The verb address, `"<noun> <verb>"` or a bare noun for a default verb. */
  readonly address: string;
  /** The prose reason the register carries — read here only to quote it back on failure. */
  readonly reason: string;
}

/** The committed offender list. */
const BaselineSchema = z.object({ offenders: z.array(z.string()) }).strict();

/** The alternation arm that matched — exactly one of the pair always does, so the assertion is honest. */
function matchedArm({ first, second }: { first: string | undefined; second: string | undefined }): string {
  if (first !== undefined) {
    return first;
  }
  return second!;
}

/** Every address `helpTruth`'s `UNGUARDED` register names, with the reason beside it. Pure.
 *
 * @param source the `helpTruth.test.ts` text
 * @returns each opt-out in declaration order, or why the register could not be read
 */
export function optOutsIn({ source }: { source: string }): Result<readonly OptOut[], DevLintInputError> {
  const opened = source.split(UNGUARDED_OPENER);
  if (opened.length !== 2) {
    return err(DevLintInputErrors.registerDeclarationMissing({ declaration: UNGUARDED_OPENER, path: HELP_TRUTH_TEST }));
  }
  const block = opened[1]!.split("\n};")[0]!;
  const entries = [...block.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w-]*)):\s*(?:"([^"]*)"|([^,\n]+))/gm)].map(
    // Each alternation pair has exactly one arm that matched: a quoted address OR a bare one, a quoted
    // reason OR an unquoted expression.
    (match): OptOut => ({
      address: matchedArm({ first: match[1], second: match[2] }),
      reason: matchedArm({ first: match[3], second: match[4] }).trim(),
    }),
  );
  return entries.length === 0 ? err(DevLintInputErrors.registerEmpty({ path: HELP_TRUTH_TEST })) : ok(entries);
}

/**
 * Parse the committed baseline. Pure.
 *
 * @param text the baseline file's text
 * @returns the committed offender addresses, or why the file could not be used
 */
export function parseBaselineJson({ text }: { text: string }): Result<readonly string[], DevLintInputError> {
  const parsed = parseJson({ text });
  if (parsed.isErr()) {
    return err(DevLintInputErrors.baselineMalformed({ detail: parsed.error.message, label: BASELINE_FILE }));
  }
  const shaped = BaselineSchema.safeParse(parsed.value);
  return shaped.success
    ? ok(shaped.data.offenders)
    : err(DevLintInputErrors.offenderListInvalid({ label: BASELINE_FILE }));
}
