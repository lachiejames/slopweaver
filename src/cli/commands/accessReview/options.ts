/**
 * The flag tail every `access-review` verb shares, and the usage text the manifest and `--help` both read.
 *
 * One parser rather than three, for the reason `cli/commands/atlas/platformResolve.ts` gives about its own
 * shared half: written three times this would be three chances for the three verbs to disagree about what
 * `--home` means, and a verb whose `--home` differs from its sibling's is a verb whose tests are lying.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

/** Every flag these verbs accept. */
const ACCESS_REVIEW_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["home"],
};

/** The flags every `access-review` verb advertises, as `--help` spells them — what the help-truth ratchet probes. */
export const ACCESS_REVIEW_FLAG_NAMES: readonly string[] = ["--home", "--json"];

/** The resolved invocation. */
export interface AccessReviewOptions {
  /** The platform a verb was pointed at, when it takes one. */
  readonly platform: string | undefined;
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse one verb's tail.
 *
 * @param rest the argv tail after the noun and verb
 * @param takesPlatform whether this verb accepts a bare platform positional
 * @returns the resolved options, or every reason the invocation was rejected
 */
export function parseAccessReviewArgs({
  rest,
  takesPlatform,
}: {
  rest: readonly string[];
  takesPlatform: boolean;
}): Result<AccessReviewOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: ACCESS_REVIEW_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, positionals } = parsed.value;
  const errors: string[] = [];
  if (!takesPlatform && positionals.length > 0) {
    errors.push(`this verb takes no positional argument — got ${positionals.join(", ")}`);
  }
  if (takesPlatform && positionals.length > 1) {
    errors.push(`name at most one platform — got ${positionals.join(", ")}`);
  }
  if (errors.length > 0) {
    return err(errors);
  }
  const home = values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    platform: positionals[0],
  });
}
