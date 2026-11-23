/**
 * The state homes a caller adds to a CHILD process's ruling-gate reads, carried in one environment variable.
 *
 * `./rulingGateDoor.ts#withCallerGateHomes` carries a caller's homes to every gate read made under it in THIS
 * process, through `AsyncLocalStorage`, which does not cross a process boundary. `automation run-due` runs each
 * row's verb in a child (`./commands/automation/runDueVerbProcess.ts`), and that child must still judge its gate
 * against the tick's home as well as the environment's: `automation run-due --home <dir>` running `datadog
 * alert-digest`, which takes no `--home`, would otherwise walk around a ruling standing in `<dir>`. So the parent
 * writes the homes here and the child's gate read adds them, exactly as an argv `--home` only ever ADDS gates.
 *
 * A value that is set and malformed is refused rather than read as no homes: reading it as none would drop a
 * constraint the caller meant to carry.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

/** The variable a run-due parent sets on its verb child. Internal: no person sets it. */
export const CALLER_GATE_HOMES_ENV = "SLOPWEAVER_CALLER_GATE_HOMES";

/** What the variable holds: a JSON array of home paths. */
const callerGateHomesSchema = z.array(z.string());

/**
 * The variable's value for these homes, each once, in first-seen order.
 *
 * @param homes the homes the caller is running over, its own inherited ones first
 * @returns the JSON text to set
 */
export function encodeCallerGateHomes({ homes }: { homes: readonly string[] }): string {
  return JSON.stringify([...new Set(homes)]);
}

/**
 * The homes a parent handed this process, none when the variable is unset.
 *
 * @param value the variable's value, `undefined` when unset
 * @returns the homes, or why a set value could not be read
 */
export function decodeCallerGateHomes({ value }: { value: string | undefined }): Result<readonly string[]> {
  if (value === undefined) {
    return ok([]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error: unknown) {
    return err([malformedLine({ why: error instanceof Error ? error.message : String(error) })]);
  }
  const checked = callerGateHomesSchema.safeParse(parsed);
  if (!checked.success) {
    return err([malformedLine({ why: "not an array of strings" })]);
  }
  return ok(checked.data);
}

/** The refusal for a set value this process cannot read. */
function malformedLine({ why }: { why: string }): string {
  return (
    `${CALLER_GATE_HOMES_ENV} is set but unreadable (${why}); automation run-due sets it on the verbs it runs, ` +
    "so a value from anywhere else is a mistake: unset it"
  );
}
