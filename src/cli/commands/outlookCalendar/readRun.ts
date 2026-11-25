/**
 * The effectful shells for the three `outlook-calendar` read verbs: parse (pure), bind the calendar's grant (its
 * own, or a held mail grant that covers it — `live/outlook/calendarGrantChoice.ts`), read, print as text or `--json`.
 *
 * The seam is the SESSION, as in `../outlook/shell.ts`: a test hands the shell a session answering a plain fake
 * {@link OutlookCalendarApi}, so the shell, the domain read and the rendering run together with no account.
 */
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { OutlookError } from "../../../live/outlook/errors.js";
import { resolveOutlookCalendarGraph } from "../../../live/outlook/session.js";
import { makeOutlookCalendarApi, type OutlookCalendarApi } from "../../../live/outlookCalendar/api.js";
import {
  listOutlookCalendars,
  listOutlookCalendarWindow,
  readOutlookCalendarEvent,
} from "../../../live/outlookCalendar/read.js";
import {
  renderOutlookCalendarEventText,
  renderOutlookCalendarsText,
  renderOutlookCalendarWindowText,
} from "../../../live/outlookCalendar/render.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { OutlookCommonArgs, Parsed } from "../outlook/core.js";
import { outlookArgsErrorLines } from "../outlook/errors.js";
import { jsonOut } from "../outlook/shell.js";
import {
  parseOutlookCalendarCalendarsArgs,
  parseOutlookCalendarListArgs,
  parseOutlookCalendarReadArgs,
} from "./core.js";

const VERB_ARG_OFFSET = 4;

/** The effects the `outlook-calendar` shells compose, production or fake. */
export interface OutlookCalendarShellDeps {
  /** Bind the calendar's grant, refusing when neither it nor a covering mail grant is stored. */
  readonly session: (args: { home: string }) => Promise<Result<OutlookCalendarApi, OutlookError>>;
  readonly home: () => string;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly warn: (line: string) => void;
}

/** The home a run reads: the one `--home` named, else the ambient one. */
function homeOf({ deps, named }: { deps: OutlookCalendarShellDeps; named: string | undefined }): string {
  if (named !== undefined) {
    return named;
  }
  return deps.home();
}

/**
 * Parse, bind, read, print — the one shape every verb here has.
 *
 * @returns the process exit code
 */
export async function runOutlookCalendarRead<A extends OutlookCommonArgs, T>({
  deps,
  parsed,
  read,
  render,
}: {
  deps: OutlookCalendarShellDeps;
  parsed: Parsed<A>;
  read: (args: { api: OutlookCalendarApi; args: A }) => Promise<Result<T, OutlookError>>;
  render: (args: { value: T }) => string;
}): Promise<number> {
  if (parsed.isErr()) {
    for (const line of [...outlookArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
      deps.warn(line);
    }
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const api = await deps.session({ home: homeOf({ deps, named: args.home }) });
  if (api.isErr()) {
    deps.warn(api.error.message);
    return EXIT_ERROR;
  }
  const result = await read({ api: api.value, args });
  if (result.isErr()) {
    deps.warn(result.error.message);
    return EXIT_ERROR;
  }
  deps.out(args.json ? jsonOut({ value: result.value }) : render({ value: result.value }));
  return EXIT_OK;
}

/**
 * Run `outlook-calendar calendars`.
 *
 * @returns the process exit code
 */
export async function runOutlookCalendarCalendars({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookCalendarShellDeps;
}): Promise<number> {
  return runOutlookCalendarRead({
    deps,
    parsed: parseOutlookCalendarCalendarsArgs({ rest }),
    read: ({ api }) => listOutlookCalendars({ api }),
    render: ({ value }) => renderOutlookCalendarsText({ calendars: value }),
  });
}

/**
 * Run `outlook-calendar list`.
 *
 * @returns the process exit code
 */
export async function runOutlookCalendarList({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookCalendarShellDeps;
}): Promise<number> {
  return runOutlookCalendarRead({
    deps,
    parsed: parseOutlookCalendarListArgs({ nowIso: deps.nowIso(), rest }),
    read: ({ api, args }) =>
      listOutlookCalendarWindow({
        api,
        calendarId: args.calendarId,
        endIso: args.endIso,
        limit: args.limit,
        startIso: args.startIso,
      }),
    render: ({ value }) => renderOutlookCalendarWindowText({ window: value }),
  });
}

/**
 * Run `outlook-calendar read`.
 *
 * @returns the process exit code
 */
export async function runOutlookCalendarReadEvent({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: OutlookCalendarShellDeps;
}): Promise<number> {
  return runOutlookCalendarRead({
    deps,
    parsed: parseOutlookCalendarReadArgs({ rest }),
    read: ({ api, args }) => readOutlookCalendarEvent({ api, eventId: args.eventId }),
    render: ({ value }) => renderOutlookCalendarEventText({ event: value }),
  });
}

/**
 * The production effects: the stored Microsoft grant, the ambient home, the wall clock and the logger.
 *
 * @returns the effects every `outlook-calendar` shell composes
 */
export function productionOutlookCalendarShellDeps(): OutlookCalendarShellDeps {
  return {
    home: slopweaverHome,
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    session: async ({ home }) => {
      const bound = await resolveOutlookCalendarGraph({ home });
      return bound.map(({ account, graph }) => makeOutlookCalendarApi({ graph, rateScopeKey: account }));
    },
    warn: (line) => {
      logger.warn({ msg: line });
    },
  };
}

/** `slopweaver outlook-calendar calendars`. */
export const outlookCalendarCalendarsCommand = defineCommand({
  run: (argv) =>
    runOutlookCalendarCalendars({ deps: productionOutlookCalendarShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver outlook-calendar list`. */
export const outlookCalendarListCommand = defineCommand({
  run: (argv) =>
    runOutlookCalendarList({ deps: productionOutlookCalendarShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver outlook-calendar read`. */
export const outlookCalendarReadCommand = defineCommand({
  run: (argv) =>
    runOutlookCalendarReadEvent({ deps: productionOutlookCalendarShellDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
