/**
 * The effectful shells for `calendar calendars`, `calendar list` and `calendar read`.
 *
 * All three are the same three steps: parse (pure), resolve a grant that carries the capability the verb
 * needs, and render what came back. The grant resolution and the API seam are injected, so the shells —
 * dispatch, the human vs `--json` choice, and the exit code — are unit tested with plain fakes and no
 * Google account.
 */
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { makeCalendarApi } from "../../../live/calendar/api.js";
import { resolveCalendarClient } from "../../../live/calendar/client.js";
import type { CalendarError } from "../../../live/calendar/errors.js";
import {
  type CalendarEventResult,
  type CalendarListingResult,
  type CalendarVocabularyResult,
  readCalendarEvent,
  readCalendarListing,
  readCalendarVocabulary,
} from "../../../live/calendar/read.js";
import {
  renderCalendarEventText,
  renderCalendarListingText,
  renderCalendarVocabularyText,
} from "../../../live/calendar/render.js";
import { renderProviderReadJson } from "../../../live/providerRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseCalendarCalendarsArgs, parseCalendarListArgs, parseCalendarReadArgs } from "./core.js";
import { calendarErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/** The seams the three read shells perform their effects through. */
export interface CalendarReadDeps {
  readonly calendars: (args: { home: string | undefined }) => Promise<Result<CalendarVocabularyResult, CalendarError>>;
  readonly list: (args: {
    home: string | undefined;
    calendarIds: readonly string[];
    timeMinIso: string;
    timeMaxIso: string;
    limit: number;
  }) => Promise<Result<CalendarListingResult, CalendarError>>;
  readonly read: (args: {
    home: string | undefined;
    calendarId: string;
    eventId: string;
  }) => Promise<Result<CalendarEventResult, CalendarError>>;
  /** The clock `calendar list`'s default window is resolved against. */
  readonly now: () => Date;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * Run `calendar calendars` against injected edges.
 *
 * @param rest argv after `calendar calendars`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runCalendarCalendars({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: CalendarReadDeps;
}): Promise<number> {
  const parsed = parseCalendarCalendarsArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of calendarErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const result = await deps.calendars({ home: parsed.value.home });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json
      ? renderProviderReadJson({ document: result.value.document })
      : renderCalendarVocabularyText({ result: result.value }),
  );
  return EXIT_OK;
}

/**
 * Run `calendar list` against injected edges.
 *
 * @param rest argv after `calendar list`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runCalendarList({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: CalendarReadDeps;
}): Promise<number> {
  const parsed = parseCalendarListArgs({ now: deps.now(), rest });
  if (parsed.isErr()) {
    for (const problem of calendarErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const { home, calendarIds, timeMinIso, timeMaxIso, limit, json } = parsed.value;
  const result = await deps.list({ calendarIds, home, limit, timeMaxIso, timeMinIso });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    json
      ? renderProviderReadJson({ document: result.value.document })
      : renderCalendarListingText({ result: result.value }),
  );
  return EXIT_OK;
}

/**
 * Run `calendar read` against injected edges.
 *
 * @param rest argv after `calendar read`
 * @param deps the read and output seams
 * @returns the process exit code
 */
export async function runCalendarRead({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: CalendarReadDeps;
}): Promise<number> {
  const parsed = parseCalendarReadArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of calendarErrorLines({ error: parsed.error })) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_USAGE;
  }
  const result = await deps.read({
    calendarId: parsed.value.calendarId,
    eventId: parsed.value.eventId,
    home: parsed.value.home,
  });
  if (result.isErr()) {
    deps.writeDiagnostic(result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    parsed.value.json
      ? renderProviderReadJson({ document: result.value.document })
      : renderCalendarEventText({ result: result.value }),
  );
  return EXIT_OK;
}

/**
 * The production read seams.
 *
 * `list` and `read` need only the `events` capability, so a `--grant events` install can run both without
 * ever approving the wider calendar-list scope. `calendars` needs `calendars`, and asks for `settings` as
 * well because that is where the account's own time zone lives — it degrades to reporting the zone as not
 * established rather than refusing, which is why the capability list here names only what it must have.
 *
 * @returns the grant-aware readers and output sinks
 */
export function productionCalendarReadDeps(): CalendarReadDeps {
  const nowIso = (): string => new Date().toISOString();
  return {
    calendars: async ({ home }) => {
      const bound = resolveCalendarClient({ capabilities: ["calendars"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readCalendarVocabulary({
        account: bound.value.account,
        api: makeCalendarApi({ account: bound.value.account, client: bound.value.client }),
        nowIso,
      });
    },
    list: async ({ home, calendarIds, timeMinIso, timeMaxIso, limit }) => {
      const bound = resolveCalendarClient({ capabilities: ["events"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readCalendarListing({
        account: bound.value.account,
        api: makeCalendarApi({ account: bound.value.account, client: bound.value.client }),
        calendarIds,
        limit,
        nowIso,
        timeMaxIso,
        timeMinIso,
      });
    },
    now: () => new Date(),
    read: async ({ home, calendarId, eventId }) => {
      const bound = resolveCalendarClient({ capabilities: ["events"], home: resolveHome({ named: home }) });
      if (bound.isErr()) {
        return err(bound.error);
      }
      return readCalendarEvent({
        account: bound.value.account,
        api: makeCalendarApi({ account: bound.value.account, client: bound.value.client }),
        calendarId,
        eventId,
        nowIso,
      });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver calendar calendars`. */
export const calendarCalendarsCommand = defineCommand({
  run: (argv) => runCalendarCalendars({ deps: productionCalendarReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver calendar list`. */
export const calendarListCommand = defineCommand({
  run: (argv) => runCalendarList({ deps: productionCalendarReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver calendar read`. */
export const calendarReadCommand = defineCommand({
  run: (argv) => runCalendarRead({ deps: productionCalendarReadDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
