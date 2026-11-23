/**
 * PURE argument handling for `calendar prep-due`, beside the rest of the noun's in `./core.ts` and under the same
 * contract: a malformed tail is refused before a credential is read, and the look-ahead window is resolved against
 * an INJECTED clock so the parser stays pure.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail } from "../../optionParsers.js";
import { type CalendarArgsError, CalendarArgsErrors } from "./errors.js";

/**
 * How far ahead `calendar prep-due` looks when the caller names no `--hours`.
 *
 * Four hours at an hourly cadence means a meeting is first registered three to four hours before it starts, which
 * leaves a seated session time to brief it and the monitor its hour before the start. Wider reads a brief written
 * the evening before, which is the "align with reality before walking in" aim done stale.
 */
const DEFAULT_PREP_HOURS = 4;

/** The widest `--hours` accepts: one day. */
const MAX_PREP_HOURS = 24;

/** Milliseconds in an hour, for turning `--hours` into a window bound. */
const HOUR_MS = 3_600_000;

/** `calendar prep-due` usage. */
const PREP_DUE_USAGE =
  "usage: slopweaver calendar prep-due [--hours <1..24>] [--dry-run] [--json] [--home <dir>]\n" +
  "  Registers one board row per upcoming meeting the owner will talk in that has no brief yet\n" +
  "  --hours    how far ahead to look (default 4)\n" +
  "  --dry-run  say which meetings would be registered, and register nothing";

/**
 * A parsed `calendar prep-due` invocation, with its look-ahead window resolved to two instants.
 *
 * @internal — the declared shape of `parseCalendarPrepDueArgs`'s success value; no caller names it.
 */
export interface CalendarPrepDueArgs {
  readonly home: string | undefined;
  readonly timeMinIso: string;
  readonly timeMaxIso: string;
  readonly horizonMs: number;
  readonly dryRun: boolean;
  readonly json: boolean;
}

/**
 * Parse the `calendar prep-due` tail.
 *
 * @param rest the argv tail after `calendar prep-due`
 * @param now the clock the look-ahead window is resolved against
 * @returns the validated request, or every reason it was refused
 */
export function parseCalendarPrepDueArgs({
  rest,
  now,
}: {
  rest: readonly string[];
  now: Date;
}): Result<CalendarPrepDueArgs, CalendarArgsError> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["dry-run", "json"], value: ["home", "hours"] } });
  if (parsed.isErr()) {
    return err(
      CalendarArgsErrors.withUsage({
        error: CalendarArgsErrors.flagsInvalid({ reasons: parsed.error }),
        usage: PREP_DUE_USAGE,
      }),
    );
  }
  const rawHours = parsed.value.values["hours"];
  const hours = rawHours === undefined ? DEFAULT_PREP_HOURS : Number(rawHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_PREP_HOURS) {
    const error = CalendarArgsErrors.argumentsRefused({
      reasons: [`--hours must be an integer between 1 and ${String(MAX_PREP_HOURS)}, got ${String(rawHours)}`],
    });
    return err(CalendarArgsErrors.withUsage({ error, usage: PREP_DUE_USAGE }));
  }
  const horizonMs = hours * HOUR_MS;
  return ok({
    dryRun: parsed.value.flags.has("dry-run"),
    home: parsed.value.values["home"],
    horizonMs,
    json: parsed.value.flags.has("json"),
    timeMaxIso: new Date(now.getTime() + horizonMs).toISOString(),
    timeMinIso: now.toISOString(),
  });
}
