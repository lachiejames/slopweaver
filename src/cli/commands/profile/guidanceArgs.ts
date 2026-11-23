/**
 * What `slopweaver profile guidance`'s flags mean — pure, so every refusal is decidable in a unit test. A read with
 * nothing to choose but its output and its home.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type FlagSpec, parseFlags } from "../../parseFlags.js";

const GUIDANCE_FLAGS = { boolean: ["json"], string: ["home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const PROFILE_GUIDANCE_FLAG_NAMES: readonly string[] = [...GUIDANCE_FLAGS.string, ...GUIDANCE_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/** A parsed `profile guidance`. */
export interface ProfileGuidanceArgs {
  readonly json: boolean;
  readonly home: string | undefined;
}

/**
 * Parse `profile guidance`'s tail.
 *
 * @param rest the argv after `profile guidance`
 * @returns the output mode and home, or every reason they were refused
 */
export function parseProfileGuidanceArgs({ rest }: { rest: readonly string[] }): Result<ProfileGuidanceArgs> {
  const parsed = parseFlags({ args: rest, spec: GUIDANCE_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = parsed.value.values["home"];
  return ok({ home: typeof home === "string" ? home : undefined, json: parsed.value.values["json"] === true });
}
