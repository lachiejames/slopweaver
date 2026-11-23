/**
 * The PURE core of `slopweaver reflect friction-review`: its flag spec and its flag parsing. The gap
 * comparison itself is `reflect/frictionReviewGap.ts`, the page `reflect/frictionReviewPage.ts`; the fs shell
 * is `frictionReviewRun.ts`.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";

/**
 * The one flag spec the verb parses with, exported so `helpTruth.test.ts` probes the REAL list rather than
 * a copy of it.
 *
 * @internal
 */
export const REFLECT_FRICTION_REVIEW_FLAG_SPEC = {
  boolean: ["republish", "mark-published", "json"],
  value: ["home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/**
 * The validated invocation for `reflect friction-review`.
 *
 * @internal
 */
export interface ReflectFrictionReviewOptions {
  /** Render the newest report as its page, publish it, then stamp it — the whole sweep step in one act. */
  readonly republish: boolean;
  /** Stamp the newest report as republished, after reporting the gap. */
  readonly markPublished: boolean;
  readonly json: boolean;
  /** The Slopweaver home to read and write under, when not the resolved one. */
  readonly home?: string;
}

/**
 * Parse `reflect friction-review`'s flags.
 *
 * `--republish` and `--mark-published` are refused together: the first already stamps, so a caller passing
 * both has either misread one of them or meant to stamp without the page, and guessing which is how a
 * republish that never happened gets stamped.
 *
 * @param rest the argv tail (after `slopweaver reflect friction-review`)
 * @returns the validated options, or every rejection
 */
export function parseReflectFrictionReviewOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<ReflectFrictionReviewOptions> {
  const parsed = parseFlagTail({ rest, spec: REFLECT_FRICTION_REVIEW_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { flags, values } = parsed.value;
  if (flags.has("republish") && flags.has("mark-published")) {
    return err(["--republish already stamps the report it publishes — pass one of --republish or --mark-published"]);
  }
  const home = values["home"];
  return ok({
    json: flags.has("json"),
    markPublished: flags.has("mark-published"),
    republish: flags.has("republish"),
    ...(home === undefined ? {} : { home }),
  });
}
