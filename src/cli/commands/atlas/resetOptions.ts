/**
 * The flag tail every atlas `reset` verb accepts, and the one guard that makes it safe.
 *
 * `--confirm archive` is required and is the whole guard: reset is the only verb in the noun that makes an
 * atlas forget, and the word names what actually happens — nothing is deleted, the generation is moved under
 * `atlas/_superseded/<platform>/`. Shared rather than copied because a copy is where the exact-word check
 * quietly becomes a truthiness check.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";
import { type AtlasCommandError, AtlasCommandErrors } from "./errors.js";

/**
 * The confirmation word, which names what the verb does rather than merely acknowledging it.
 *
 * @internal
 */
export const ATLAS_RESET_CONFIRMATION = "archive";

/**
 * Parse an atlas reset's flag tail, refusing anything but the exact confirmation word.
 *
 * @param rest the flag tail, past the verb
 * @returns the resolved home and output shape, or why the invocation is refused
 */
export function parseAtlasResetOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean }, AtlasCommandError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["confirm", "home"] } });
  if (parsed.isErr()) {
    return err(AtlasCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const confirm = parsed.value.values["confirm"];
  if (confirm !== ATLAS_RESET_CONFIRMATION) {
    if (confirm === undefined) {
      return err(AtlasCommandErrors.resetEmptyConfirmRequired({ word: ATLAS_RESET_CONFIRMATION }));
    }
    return err(AtlasCommandErrors.confirmMismatch({ confirm, expected: ATLAS_RESET_CONFIRMATION }));
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}
