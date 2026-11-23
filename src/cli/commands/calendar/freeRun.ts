/**
 * The effectful shell for `calendar free`: parse (pure), resolve a grant that can answer free/busy, resolve
 * the zone the caller reads in, and render what came back. The reader and the zone lookup are injected, so
 * the shell — dispatch, the human vs `--json` choice, the exit code — is unit tested with plain fakes.
 *
 * ## The zone is resolved here, not in the reader
 *
 * `--between 09:00-17:00` is a wall-clock statement and needs a zone to mean anything. The account's own
 * zone lives behind `settings.get`, which the read grant carries and the narrow `events` grant does not, so
 * the shell asks for it, degrades to UTC when it cannot, and tells the reader whether the zone was
 * established — the reader turns that into a residue line rather than silently rendering in the wrong zone.
 */
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { makeCalendarApi } from "../../../live/calendar/api.js";
import { resolveCalendarClient } from "../../../live/calendar/client.js";
import type { CalendarError } from "../../../live/calendar/errors.js";
import { type CalendarFreeResult, readCalendarFree } from "../../../live/calendar/free.js";
import { makeCalendarFreeBusyApi } from "../../../live/calendar/freeApi.js";
import { renderCalendarFreeText } from "../../../live/calendar/render.js";
import type { DailyHours } from "../../../live/calendar/wallClockText.js";
import { renderProviderReadJson } from "../../../live/providerRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseCalendarFreeArgs } from "./core.js";
import { calendarErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** The zone every free read falls back to when the account's own cannot be established. */
export const FALLBACK_ZONE = "UTC";

/**
 * The zone a free read renders in, and whether it is the account's own. A zone neither the caller named nor
 * the grant could read is the designed degrade to {@link FALLBACK_ZONE}, carried with `zoneEstablished: false`
 * so the reader prints its residue line rather than rendering silently in the wrong zone.
 */
function readingZone({ resolved }: { resolved: string | undefined }): { zone: string; zoneEstablished: boolean } {
  if (resolved === undefined) {
    return { zone: FALLBACK_ZONE, zoneEstablished: false };
  }
  return { zone: resolved, zoneEstablished: true };
}

/** The seams the free shell performs its effects through. */
export interface CalendarFreeDeps {
  readonly free: (args: {
    home: string | undefined;
    calendarIds: readonly string[];
    timeMinIso: string;
    timeMaxIso: string;
    minutes: number;
    between: DailyHours | undefined;
    zone: string | undefined;
  }) => Promise<Result<CalendarFreeResult, CalendarError>>;
  /** The clock the default window is resolved against. */
  readonly now: () => Date;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `calendar free` against injected edges.
 *
 * @param rest argv after `calendar free`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runCalendarFree({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: CalendarFreeDeps;
}): Promise<number> {
  const parsed = parseCalendarFreeArgs({ now: deps.now(), rest });
  if (parsed.isErr()) {
    for (const problem of calendarErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { home, calendarIds, timeMinIso, timeMaxIso, minutes, between, zone, json } = parsed.value;
  const result = await deps.free({ between, calendarIds, home, minutes, timeMaxIso, timeMinIso, zone });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    json
      ? renderProviderReadJson({ document: result.value.document })
      : renderCalendarFreeText({ result: result.value }),
  );
  return EXIT_OK;
}

/**
 * The production free seam.
 *
 * Needs `freebusy`, which the read grant's `calendar.readonly` satisfies. Asks for the account zone only
 * when the caller named none, and only if the grant carries `settings`; either way the read says whether
 * the zone it used was established.
 *
 * @returns the grant-aware reader and output sinks
 */
export function productionCalendarFreeDeps(): CalendarFreeDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    free: async ({ home, calendarIds, timeMinIso, timeMaxIso, minutes, between, zone }) => {
      const resolvedHome = resolveHome({ named: home });
      const bound = resolveCalendarClient({ capabilities: ["freebusy"], home: resolvedHome });
      if (bound.isErr()) {
        return err(bound.error);
      }
      const { account, client } = bound.value;
      let resolvedZone = zone;
      if (
        resolvedZone === undefined &&
        resolveCalendarClient({ capabilities: ["settings"], home: resolvedHome }).isOk()
      ) {
        const accountZone = await makeCalendarApi({ account, client }).getTimeZone();
        resolvedZone = accountZone.isOk() ? accountZone.value : undefined;
      }
      return readCalendarFree({
        account,
        api: makeCalendarFreeBusyApi({ account, client }),
        between,
        calendarIds,
        minutes,
        nowIso,
        timeMaxIso,
        timeMinIso,
        ...readingZone({ resolved: resolvedZone }),
      });
    },
    now: () => new Date(),
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver calendar free`. */
export const calendarFreeCommand = defineCommand({
  run: (argv) => runCalendarFree({ deps: productionCalendarFreeDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
