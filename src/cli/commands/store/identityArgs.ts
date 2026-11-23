/**
 * The PURE parse of a `store identity` invocation, and the flag-name helper every `store` verb's advertised
 * list is derived with — split out of `./core.ts` so the query surface there stays a file a reader can hold.
 *
 * `flagNames` lives here rather than in `./core.ts` because this module must not import that one: core reads
 * the store manifest, whose lazy loader reaches `./run.ts`, which imports this file.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";

/** `store identity` reads the member store whole; the only choice is where to read it from. */
const IDENTITY_FLAGS: FlagSpec = { boolean: ["json", "pull"], string: ["home"] };

/** The flags `store identity` advertises. */
export const STORE_IDENTITY_FLAG_NAMES: readonly string[] = flagNames({ spec: IDENTITY_FLAGS });

/**
 * Every flag a spec declares, as the `--name` tokens a usage line spells.
 *
 * Derived from the spec the parser actually uses rather than restated, so the advertised list and the
 * accepted list cannot disagree — which is half of what `helpTruth` checks and the half a hand-written
 * array gets wrong.
 *
 * @param spec the flag spec to enumerate
 * @returns the flag tokens, sorted
 */
export function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  return [...stringFlagsOf({ spec }), ...booleanFlagsOf({ spec })].map((name) => `--${name}`).toSorted();
}

/** A parsed identity invocation: which state home to read members from, and the output mode. */
export interface StoreIdentityArgs {
  readonly home: string | undefined;
  readonly json: boolean;
  /** Whether to read the Google Workspace directory through the grant first, or reconcile what is on disk. */
  readonly pull: boolean;
}

/**
 * Parse an identity invocation, which takes no filter because a reconcile is all-or-nothing.
 *
 * There is deliberately no `--source` and no `--limit`. The ladder's answer for one identity depends on
 * the people already placed, so reconciling a subset would produce a different person set than reconciling
 * the whole — a flag that quietly changed the ANSWER rather than the scope.
 *
 * @param rest the flag tail
 * @returns the parsed invocation, or every reason it was refused
 */
export function parseStoreIdentityArgs({ rest }: { rest: readonly string[] }): Result<StoreIdentityArgs> {
  const parsed = parseFlags({ args: rest, spec: IDENTITY_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = parsed.value.values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    pull: parsed.value.values["pull"] === true,
  });
}
