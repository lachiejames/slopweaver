/**
 * `codex review-fallback`'s flag reads: one string flag, and `prepare`'s required set as one typed value or the
 * one failure naming every flag it requires (`./fallbackReviewRun.ts` is the verb).
 */
import type { ReviewPassId, ReviewProperty } from "../../../codex/types.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { type CodexCommandError, CodexCommandErrors } from "./errors.js";

/**
 * A string flag's value, or `undefined` when it was not given or is blank.
 *
 * @returns the value
 */
export function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** The review passes a fallback may stand in for. */
const REVIEW_PASSES: ReadonlySet<string> = new Set<ReviewPassId>(["r1", "r2", "r3"]);

/** Narrow a flag value to a review pass id. A predicate, so TS1230 rules out destructuring. */
function isReviewPassId(value: unknown): value is ReviewPassId {
  return typeof value === "string" && REVIEW_PASSES.has(value);
}

/** What `prepare` needs from its flags, or the reason the flags do not supply it. */
export interface PrepareArgs {
  readonly pass: ReviewPassId;
  readonly property: ReviewProperty;
  readonly base: string;
  readonly maxDiffBytes: number;
}

/**
 * Read `prepare`'s required flags, without a filesystem.
 *
 * @param parsed the parsed flag tail
 * @returns the arguments, or the one failure naming every flag `prepare` requires
 */
export function preparePrepareArgs({ parsed }: { parsed: ParsedFlags }): Result<PrepareArgs, CodexCommandError> {
  const pass = stringFlag({ name: "pass", parsed });
  const propertyId = stringFlag({ name: "property-id", parsed });
  const statement = stringFlag({ name: "property", parsed });
  const base = stringFlag({ name: "base", parsed });
  const maxDiffBytes = Number(stringFlag({ name: "max-diff-bytes", parsed }));
  const complete =
    isReviewPassId(pass) &&
    propertyId !== undefined &&
    statement !== undefined &&
    base !== undefined &&
    Number.isInteger(maxDiffBytes) &&
    maxDiffBytes > 0;
  if (!complete) {
    return err(CodexCommandErrors.prepareFlagsMissing());
  }
  return ok({ base, maxDiffBytes, pass, property: { id: propertyId, statement } });
}
