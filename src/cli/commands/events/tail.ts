/**
 * `slopweaver events tail` — read the supervisor stream, from where you left off.
 *
 * Two modes, and the difference is the one that matters to a supervisor:
 *
 * - **Drain** (default): read from the cursor to the end of the file, print, advance the cursor, exit. It is
 *   a file read, so it is instant and needs no deadline at all — unlike a socket subscription, there is
 *   nothing to wait for and no quiet timer to get wrong.
 * - **`--follow`**: keep reading as the file grows. This is the wake-on-signal shape, so a listener death
 *   reaches a watching session in about a second instead of at the next twenty-minute sweep.
 *
 * ## Why it exits 3 on an alert
 *
 * The verb is a DIAGNOSTIC in the same sense `listen status` is: `EXIT_EXPECTED_EMPTY` means it ran
 * perfectly and found something. So `slopweaver events tail --cursor supervisor || <surface it>` is a whole
 * supervision idiom in one line, and a caller that reads only the exit code still cannot miss a death. A
 * quiet stream — the healthy case — exits 0.
 *
 * A GAP exits 3 too. The stream was truncated or replaced under a reader, so events between its last
 * position and the new start are gone; saying so loudly is the whole difference between a cursor and a
 * guess.
 */
import { slopweaverHome } from "../../../config.js";
import { writeSupervisorEventCursor } from "../../../events/cursor.js";
import {
  meetsSeverity,
  renderSupervisorEventLine,
  SUPERVISOR_EVENT_SEVERITIES,
  SUPERVISOR_EVENT_SOURCES,
  type SupervisorEvent,
  type SupervisorEventSeverity,
  type SupervisorEventSource,
  severityOf,
} from "../../../events/event.js";
import { readSupervisorEventsFrom, type SupervisorStreamEntry } from "../../../events/store.js";
import { deferred } from "../../../lib/deferred.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { resolveStartOffset } from "./tailStart.js";
import { EVENTS_TAIL_USAGE } from "./tailUsage.js";

/** Where this family's own arguments start in `process.argv`: `[node, cli, events, <verb>, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/** How often `--follow` re-reads the file. Fast enough that a death reaches a watcher inside a second. */
const FOLLOW_POLL_MS = 750;

/** The verb's flag spec. */
const TAIL_SPEC: FlagSpec = {
  boolean: ["follow", "json"],
  string: ["cursor", "deadline-ms", "home", "kind", "limit", "min-severity", "since", "source"],
};

/** `events tail`'s advertised flags, for the help-truth ratchet. */
export const EVENTS_TAIL_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: TAIL_SPEC }),
  ...booleanFlagsOf({ spec: TAIL_SPEC }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `events tail`'s flags. Exported so the help-truth ratchet pushes every advertised flag through the
 * REAL parser rather than comparing two declarations with each other.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or every rejection
 */
export function parseEventsTailArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: TAIL_SPEC });
}

/** Everything the verb decided from its flags, before any file is opened. */
export interface EventsTailRequest {
  readonly cursorName: string | undefined;
  readonly since: number | undefined;
  readonly source: SupervisorEventSource | undefined;
  readonly kinds: readonly string[];
  readonly minSeverity: SupervisorEventSeverity;
  readonly limit: number | undefined;
  readonly follow: boolean;
  readonly deadlineMs: number | undefined;
  readonly asJson: boolean;
  readonly home: string;
}

/** Read one flag as a non-negative integer, or the rejection naming it. */
function integerFlag({
  name,
  values,
}: {
  name: string;
  values: Readonly<Record<string, string | boolean>>;
}): Result<number | undefined> {
  const raw = values[name];
  if (raw === undefined || typeof raw === "boolean") {
    return ok(undefined);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return err([`--${name} must be a non-negative whole number, not ${JSON.stringify(raw)}`]);
  }
  return ok(parsed);
}

/** Read a flag constrained to a closed set of strings, or the rejection listing what is allowed. */
function choiceFlag<T extends string>({
  allowed,
  name,
  values,
}: {
  allowed: readonly T[];
  name: string;
  values: Readonly<Record<string, string | boolean>>;
}): Result<T | undefined> {
  const raw = values[name];
  if (raw === undefined || typeof raw === "boolean") {
    return ok(undefined);
  }
  const match = allowed.find((candidate) => candidate === raw);
  return match === undefined ? err([`--${name} must be one of ${allowed.join(", ")}, not ${raw}`]) : ok(match);
}

/** The severity floor `--min-severity` asked for; with no flag every event passes, so the floor is `info`. */
function severityFloor({ chosen }: { chosen: Result<SupervisorEventSeverity | undefined> }): SupervisorEventSeverity {
  const named = chosen.isOk() ? chosen.value : undefined;
  if (named === undefined) {
    return "info";
  }
  return named;
}

/**
 * Fold parsed flags into the request, accumulating EVERY rejection rather than stopping at the first — a
 * caller who got two flags wrong should be told both times, not made to run it twice.
 *
 * @param parsed the already-tokenized flags
 * @returns the request, or every rejection
 */
export function eventsTailRequest({ parsed }: { parsed: ParsedFlags }): Result<EventsTailRequest> {
  const values = parsed.values;
  const since = integerFlag({ name: "since", values });
  const limit = integerFlag({ name: "limit", values });
  const deadline = integerFlag({ name: "deadline-ms", values });
  const source = choiceFlag({ allowed: SUPERVISOR_EVENT_SOURCES, name: "source", values });
  const minSeverity = choiceFlag({ allowed: SUPERVISOR_EVENT_SEVERITIES, name: "min-severity", values });
  const cursorName = values["cursor"];
  // An explicitly empty name is unusable, never "no cursor": read as absent, it skipped the name check.
  const emptyCursor = cursorName === "" ? ["--cursor was given an empty name — pass the cursor's name itself"] : [];
  const rejections = [
    ...[since, limit, deadline, source, minSeverity].flatMap((result) => (result.isErr() ? [...result.error] : [])),
    ...emptyCursor,
  ];
  if (rejections.length > 0) {
    return err(rejections);
  }
  const home = values["home"];
  const kind = values["kind"];
  return ok({
    asJson: values["json"] === true,
    cursorName: typeof cursorName === "string" && cursorName.length > 0 ? cursorName : undefined,
    deadlineMs: deadline.isOk() ? deadline.value : undefined,
    follow: values["follow"] === true,
    home: typeof home === "string" && home.length > 0 ? home : slopweaverHome(),
    kinds:
      typeof kind === "string"
        ? kind
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
        : [],
    limit: limit.isOk() ? limit.value : undefined,
    minSeverity: severityFloor({ chosen: minSeverity }),
    since: since.isOk() ? since.value : undefined,
    source: source.isOk() ? source.value : undefined,
  });
}

/**
 * Whether one event passes the request's filters.
 *
 * @param event the event to test
 * @param request the already-resolved request
 * @returns true when it should be printed
 */
export function passesFilters({
  event,
  request,
}: {
  event: SupervisorEvent;
  request: Pick<EventsTailRequest, "kinds" | "minSeverity" | "source">;
}): boolean {
  if (request.source !== undefined && event.source !== request.source) {
    return false;
  }
  if (request.kinds.length > 0 && !request.kinds.includes(event.kind)) {
    return false;
  }
  return meetsSeverity({ event, minimum: request.minSeverity });
}

/** What one pass over the stream printed, and where it left the cursor. */
interface PassResult {
  readonly offset: number;
  readonly printed: number;
  readonly alerted: boolean;
  readonly gap: boolean;
}

/**
 * Print one batch, respecting a remaining print budget.
 *
 * The offset returned is the end of the last event this pass actually PRINTED — never the end of what it
 * read. A cursor that outran the work it is a cursor for is the measured defect `cmux events` fixed in its
 * own drain, and the skip it causes is silent.
 */
function printBatch({
  budget,
  entries,
  offsetAfter,
  request,
  startOffset,
}: {
  budget: number | undefined;
  entries: readonly SupervisorStreamEntry[];
  offsetAfter: number;
  request: EventsTailRequest;
  startOffset: number;
}): { readonly printed: number; readonly alerted: boolean; readonly offset: number } {
  let printed = 0;
  let alerted = false;
  let offset = startOffset;
  for (const entry of entries) {
    if (budget !== undefined && printed >= budget) {
      return { alerted, offset, printed };
    }
    // Each consumed entry — printed or filtered out — advances the cursor past its own line, so a `--limit`
    // run resumes exactly at the first event it did not consume.
    offset = entry.endOffset;
    if (!passesFilters({ event: entry.event, request })) {
      continue;
    }
    printed += 1;
    alerted = alerted || severityOf({ event: entry.event }) === "alert";
    logger.out({
      line: request.asJson ? JSON.stringify(entry.event) : renderSupervisorEventLine({ event: entry.event }),
    });
  }
  return { alerted, offset: offsetAfter, printed };
}

/** Read once from an offset, print what passes, and report where to resume. */
function onePass({ fromOffset, request }: { fromOffset: number; request: EventsTailRequest }): Result<PassResult> {
  return readSupervisorEventsFrom({ fromOffset, home: request.home }).map((read) => {
    if (read.gap) {
      logger.error({
        msg:
          "events tail: GAP — the stream is shorter than the recorded cursor, so it was truncated or " +
          "replaced and everything between is gone. Restarting from the beginning of the file.",
      });
    }
    const batch = printBatch({
      budget: request.limit,
      entries: read.entries,
      offsetAfter: read.offset,
      request,
      startOffset: read.gap ? 0 : fromOffset,
    });
    if (read.unreadable > 0) {
      logger.error({ msg: `events tail: dropped ${String(read.unreadable)} line(s) that would not decode` });
    }
    return { alerted: batch.alerted, gap: read.gap, offset: batch.offset, printed: batch.printed };
  });
}

/** Record the cursor, narrating a failure rather than pretending the read did not happen. */
function recordCursor({ offset, request }: { offset: number; request: EventsTailRequest }): void {
  if (request.cursorName === undefined) {
    return;
  }
  const written = writeSupervisorEventCursor({
    home: request.home,
    name: request.cursorName,
    nowIso: new Date().toISOString(),
    offset,
  });
  if (written.isErr()) {
    logger.error({ msg: `events tail: ${written.error.join("; ")}` });
  }
}

/**
 * Follow the file until the deadline elapses or the process is interrupted.
 *
 * The interrupt is RACED against the poll interval rather than polled as a flag, so a Ctrl-C ends the run at
 * once instead of after the rest of the current sleep — and the loop has no condition that a signal handler
 * mutates behind the reader's back.
 */
async function follow({ fromOffset, request }: { fromOffset: number; request: EventsTailRequest }): Promise<number> {
  const startedMs = Date.now();
  const stopped = deferred<"stopped">();
  const onInterrupt = (): void => {
    stopped.settle({ value: "stopped" });
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  let offset = fromOffset;
  let alerted = false;
  try {
    for (;;) {
      const pass = onePass({ fromOffset: offset, request });
      if (pass.isErr()) {
        logger.error({ msg: `events tail: ${pass.error.join("; ")}` });
        return EXIT_ERROR;
      }
      offset = pass.value.offset;
      alerted = alerted || pass.value.alerted;
      recordCursor({ offset, request });
      if (request.deadlineMs !== undefined && Date.now() - startedMs >= request.deadlineMs) {
        break;
      }
      const woke = await Promise.race([stopped.promise, sleep({ ms: FOLLOW_POLL_MS })]);
      if (woke === "stopped") {
        break;
      }
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
  return alerted ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** One poll interval, as a promise that resolves with what it is — so a race can say which side won. */
async function sleep({ ms }: { ms: number }): Promise<"ticked"> {
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve("ticked");
    }, ms),
  );
}

/**
 * `slopweaver events tail` — drain or follow the supervisor stream.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export const eventsTailCommand = defineCommand({
  run: async (argv) => {
    const parsed = parseEventsTailArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      return refuse({ errors: parsed.error });
    }
    const request = eventsTailRequest({ parsed: parsed.value });
    if (request.isErr()) {
      return refuse({ errors: request.error });
    }
    const from = resolveStartOffset({ request: request.value });
    if (from.isErr()) {
      // An unusable cursor NAME is a usage mistake and gets the usage text; a cursor FILE that cannot be
      // trusted is not, so it prints its own way out and exits 1.
      if (from.error.code === "CURSOR_NAME_UNUSABLE") {
        return refuse({ errors: [from.error.message] });
      }
      logger.error({ msg: from.error.message });
      return EXIT_ERROR;
    }
    if (request.value.follow) {
      return follow({ fromOffset: from.value, request: request.value });
    }
    const pass = onePass({ fromOffset: from.value, request: request.value });
    if (pass.isErr()) {
      logger.error({ msg: `events tail: ${pass.error.join("; ")}` });
      return EXIT_ERROR;
    }
    recordCursor({ offset: pass.value.offset, request: request.value });
    return pass.value.alerted || pass.value.gap ? EXIT_EXPECTED_EMPTY : EXIT_OK;
  },
});

/** Print every rejection plus the usage line, and return the usage exit code. */
function refuse({ errors }: { errors: readonly string[] }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  logger.error({ msg: EVENTS_TAIL_USAGE });
  return EXIT_USAGE;
}
