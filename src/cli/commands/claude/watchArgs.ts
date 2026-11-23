/**
 * `claude watch`'s argument parser — strict, pure, and read before anything else the verb does.
 *
 * Strict because this verb writes credentials: its hand-rolled parser IGNORED a flag it did not know, and on
 * a mistyped flag started a second, full watch beside the running one instead of being refused.
 * Split out of `./watch.ts` so the help ratchet can probe the real parser without loading the loop.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import {
  acceptedWatchInterval,
  MAX_WATCH_INTERVAL_MINUTES,
  MIN_WATCH_INTERVAL_MINUTES,
} from "../../../live/standing/processes.js";
import { parseFlags } from "../../parseFlags.js";

/** How often the loop ticks by default, in minutes — and therefore its worst case for noticing a wall. */
const DEFAULT_INTERVAL_MINUTES = 5;

/** The flags this verb accepts, and the ONLY place they are named — its usage is held to this by `helpTruth`. */
const WATCH_FLAG_SPEC = { boolean: ["once", "dry-run", "json", "wait"], string: ["interval"] } as const;

/**
 * Every flag this verb advertises, derived from the spec it actually parses with so the two cannot drift.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_WATCH_FLAG_NAMES: readonly string[] = [
  ...WATCH_FLAG_SPEC.string.map((name) => `--${name}`),
  ...WATCH_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** What one `claude watch` invocation asked for. */
export interface ClaudeWatchArgs {
  /** Minutes between ticks, within {@link MIN_WATCH_INTERVAL_MINUTES}..{@link MAX_WATCH_INTERVAL_MINUTES}. */
  readonly intervalMinutes: number;
  /** One tick, then exit. */
  readonly once: boolean;
  /** Report a tick and write nothing at all. */
  readonly dryRun: boolean;
  /** Emit the machine document instead of the human lines. */
  readonly wantsJson: boolean;
  /** Queue behind a running watch instead of refusing, and start the moment none is running. */
  readonly wait: boolean;
}

/**
 * How many minutes apart the ticks should be, defaulting when the caller named no interval.
 *
 * Bounded at both ends on purpose. Below the floor the probes cost more than the detection they buy, and
 * past the ceiling the loop no longer beats the owner noticing a wall themselves, which is the only thing it
 * is for. The bounds live beside the process classifier, which must refuse exactly what this refuses.
 *
 * @param raw the parsed `--interval` value, when one was given
 * @param errors the accumulator every problem is pushed into, so a caller sees all of them at once
 * @returns the interval in minutes; the default when the flag is absent, and unusable when `errors` grew
 */
function parseIntervalMinutes({ errors, raw }: { errors: string[]; raw: string | boolean | undefined }): number {
  if (typeof raw !== "string") {
    return DEFAULT_INTERVAL_MINUTES;
  }
  // The same rule the process-table classifier applies, so the two can never disagree about whether a
  // running watch is one — `acceptedWatchInterval`'s header has the `1e0` counterexample.
  const minutes = acceptedWatchInterval({ raw });
  if (minutes !== undefined) {
    return minutes;
  }
  errors.push(
    /^[1-9]\d*$/u.test(raw)
      ? `--interval must be between ${String(MIN_WATCH_INTERVAL_MINUTES)} and ${String(MAX_WATCH_INTERVAL_MINUTES)} minutes`
      : "--interval must be a positive integer",
  );
  return DEFAULT_INTERVAL_MINUTES;
}

/**
 * Parse this verb's own argument tail, strictly, before any file is read.
 *
 * `--wait --dry-run` is refused: a dry run writes nothing, so there is no turn to wait for. `--wait --once`
 * is allowed — it waits for admission and then performs one real tick.
 *
 * @param rest the argv tail, after `claude watch`
 * @returns what was asked for, or every rejection at once
 */
export function parseClaudeWatchArgs({ rest }: { readonly rest: readonly string[] }): Result<ClaudeWatchArgs> {
  const parsed = parseFlags({ args: rest, spec: WATCH_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const errors: string[] = [];
  const intervalMinutes = parseIntervalMinutes({ errors, raw: values["interval"] });
  const dryRun = values["dry-run"] === true;
  const wait = values["wait"] === true;
  if (wait && dryRun) {
    errors.push("--wait cannot be combined with --dry-run: a dry run writes nothing, so there is no turn to wait for");
  }
  if (errors.length > 0) {
    return err(errors);
  }
  return ok({ dryRun, intervalMinutes, once: values["once"] === true, wait, wantsJson: values["json"] === true });
}
