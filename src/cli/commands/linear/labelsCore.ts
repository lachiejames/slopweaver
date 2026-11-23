/** Pure argument handling for `slopweaver linear labels`. */

import { err, ok, type Result } from "../../../lib/result.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";

const LABELS_FLAGS: FlagSpec = { boolean: ["json"], string: ["home", "team"] };

/** Every accepted flag, WITH the `--`, derived from the exact spec passed to the parser. */
export const LINEAR_LABELS_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LABELS_FLAGS }),
  ...booleanFlagsOf({ spec: LABELS_FLAGS }),
].map((name) => `--${name}`);

/** A parsed, credential-free `linear labels` invocation. */
export interface LinearLabelsOptions {
  readonly teamKey: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse one `linear labels` invocation before any credential or network is touched.
 *
 * The team may be given as `--team SOPS` or as a bare positional, the same two readings `linear states`
 * accepts, because this verb also takes exactly one address.
 *
 * @param rest the argv tail after `linear labels`
 * @returns the resolved options, or the usage problem found
 */
export function parseLinearLabelsArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<LinearLabelsOptions, LinearVerbError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: LABELS_FLAGS });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const flagged = parsed.value.values["team"];
  const teamKey = typeof flagged === "string" ? flagged : parsed.value.positionals[0];
  if (teamKey === undefined || teamKey.length === 0) {
    return err(LinearVerbErrors.teamMissing());
  }
  const home = parsed.value.values["home"];
  return ok({
    home: typeof home === "string" ? home : undefined,
    json: parsed.value.values["json"] === true,
    teamKey,
  });
}
