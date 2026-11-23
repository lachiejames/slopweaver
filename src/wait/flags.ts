/**
 * The two flags every verb's `--wait` shares — `--wait` and `--timeout-seconds` — parsed once, so a wait on
 * `turn review --poll`, `machine capacity` and `cmux spawn` refuses the same mistakes with the same words.
 */
import { err, ok, type Result } from "../lib/result.js";
import { DEFAULT_WAIT_TIMEOUT_SECONDS } from "./loop.js";

/** The wait flags, to spread into a verb's own flag spec. */
export const WAIT_FLAG_SPEC = { boolean: ["wait"], string: ["timeout-seconds"] } as const;

/** A resolved `--wait`: whether to wait, and for how long. */
export interface WaitOptions {
  readonly wait: boolean;
  readonly timeoutSeconds: number;
}

/**
 * Resolve `--wait` and `--timeout-seconds` out of a verb's already-parsed flag values.
 *
 * @param values the verb's parsed flag values
 * @returns the options, or the one problem found
 */
export function parseWaitOptions({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<WaitOptions> {
  const wait = values["wait"] === true;
  const raw = values["timeout-seconds"];
  if (typeof raw !== "string") {
    return ok({ timeoutSeconds: DEFAULT_WAIT_TIMEOUT_SECONDS, wait });
  }
  if (!wait) {
    return err(["--timeout-seconds only means something with --wait"]);
  }
  const timeoutSeconds = Number(raw);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    return err(["--timeout-seconds must be a positive whole number"]);
  }
  return ok({ timeoutSeconds, wait });
}
