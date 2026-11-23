/**
 * Pure argument handling for `slack read-file`. Parsing is separated from the shell so the flag surface is
 * unit-testable without a token, a network or a filesystem — and so `helpTruth` can import the flag list and
 * prove `--help` names exactly what the verb accepts. The same split `readThreadCore.ts` uses, for the same
 * reason.
 */

import { err, ok } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type SlackRead, SlackReadErrors } from "./readErrors.js";

/** Every flag this verb accepts. Exported so the help-truth ratchet checks against the real list. *
 * @internal — the flag spec the help-truth ratchet compares against; not a public surface.
 */
export const SLACK_READ_FILE_FLAGS: FlagSpec = {
  boolean: ["json", "no-transcript"],
  string: ["home"],
};

/**
 * Every flag NAME, derived from the spec rather than re-listed — so the help-truth ratchet compares the
 * usage string against what the parser genuinely accepts, and the two cannot drift apart.
 *
 * @internal — derived from the spec for the help-truth ratchet alone.
 */
export const SLACK_READ_FILE_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: SLACK_READ_FILE_FLAGS }),
  ...stringFlagsOf({ spec: SLACK_READ_FILE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation. *
 * @internal — the parser's own return shape; the shell beside it is the only consumer.
 */
export interface SlackReadFileOptions {
  readonly reference: string;
  readonly json: boolean;
  /** True when the caller asked for the notes without the transcript. */
  readonly noTranscript: boolean;
  readonly home: string | undefined;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `slack read-file`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseSlackReadFileArgs({ rest }: { rest: readonly string[] }): SlackRead<SlackReadFileOptions> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: SLACK_READ_FILE_FLAGS });
  if (parsed.isErr()) {
    return err(SlackReadErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values, positionals } = parsed.value;
  if (positionals.length === 0) {
    return err(SlackReadErrors.fileReferenceMissing());
  }
  if (positionals.length > 1) {
    return err(SlackReadErrors.fileReferenceCount({ references: positionals }));
  }
  const home = typeof values["home"] === "string" ? values["home"] : undefined;
  return ok({
    home,
    json: values["json"] === true,
    noTranscript: values["no-transcript"] === true,
    reference: positionals[0]!,
  });
}
