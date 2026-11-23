/**
 * The `POLLY_MODE` parse for the integration lane's `setup-polly.ts`, kept pure so the rule is unit-testable
 * without importing the setup file (which registers a process-global fetch adapter at module scope).
 *
 * The rule (fail early on what must exist): UNSET is the documented default, strict offline
 * `replay`; a value that is SET but is not one of the modes is an error, never a fall back to replay. The
 * fallback it replaces gave someone who meant `POLLY_MODE=record` and typed `recrod` a green replay run, and
 * the belief that a cassette had been re-recorded.
 */
import { isOneOf } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

/** The modes `POLLY_MODE` selects between (see `setup-polly.ts`). */
export const POLLY_MODES = ["record", "replay", "passthrough"] as const;

/** One of {@link POLLY_MODES}. */
export type PollyMode = (typeof POLLY_MODES)[number];

/**
 * Parse the raw `POLLY_MODE` environment value.
 *
 * @param raw the variable's value, `undefined` when it is not set
 * @returns the mode (`replay` when unset), or an error naming the unrecognised value and the valid modes
 */
export function parsePollyMode({ raw }: { raw: string | undefined }): Result<PollyMode> {
  if (raw === undefined) {
    return ok("replay");
  }
  if (isOneOf(raw, POLLY_MODES)) {
    return ok(raw);
  }
  return err([`POLLY_MODE=${JSON.stringify(raw)} is not a mode; valid modes are ${POLLY_MODES.join(", ")}`]);
}

/**
 * The setup file's edge over {@link parsePollyMode}: the mode, or a throw at module load, so the whole
 * integration file fails before a single test runs on a mode nobody meant.
 *
 * @param raw the variable's value, `undefined` when it is not set
 * @returns the parsed mode
 */
export function pollyModeOrThrow({ raw }: { raw: string | undefined }): PollyMode {
  const parsed = parsePollyMode({ raw });
  if (parsed.isErr()) {
    throw new Error(parsed.error.join("; "));
  }
  return parsed.value;
}
