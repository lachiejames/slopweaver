/**
 * What `slopweaver talk attach` accepts — its flag spec, the names the help-truth ratchet reads, and the pure parser.
 * The usage line is in `./usage.ts`, a leaf the manifest quotes without loading this.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";

/** The flags `talk attach` accepts. */
const ATTACH_FLAGS = { boolean: ["json"], string: ["file", "name", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_ATTACH_FLAG_NAMES: readonly string[] = flagNames({ spec: ATTACH_FLAGS });

/** A parsed `talk attach` invocation. */
export interface AttachArgs {
  /** The staged copy to keep: the console's own `0600` file in a per-request temporary directory. */
  readonly file: string;
  /** The name they chose the file under, judged by `src/talk/attachment.ts` when the verb runs. */
  readonly name: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk attach` invocation. The name and the bytes are judged when the verb reads the file, so a refusal
 * names the file they chose rather than a flag.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseAttachArgs({ rest }: { rest: readonly string[] }): Result<AttachArgs> {
  const parsed = parseFlags({ args: rest, spec: ATTACH_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const file = stringOf({ value: values["file"] });
  const name = stringOf({ value: values["name"] });
  const problems: string[] = [];
  if (file === undefined) {
    problems.push("talk attach needs --file <staged-file>: the copy to keep");
  }
  if (name === undefined) {
    problems.push("talk attach needs --name <their file name>: what they chose it under");
  }
  if (file === undefined || name === undefined) {
    return err(problems);
  }
  return ok({ file, home: stringOf({ value: values["home"] }), json: values["json"] === true, name });
}
