/**
 * `slopweaver cmux events` — the reconnectable hook stream, through the door.
 *
 * Two modes, and the difference matters to a supervisor:
 *
 * - **Drain** (default): replay from `--since <seq>` to the live edge, print what is there, and exit. This is
 *   what a sweep calls; it advances the recorded cursor so the next drain starts where this one stopped.
 * - **`--follow`**: stay subscribed and keep printing until interrupted. This is the wake-on-signal shape the
 *   20-minute timer sweep was doing badly.
 *
 * Whichever mode, the cursor is committed to the local store (the `cmux-events` row of `cmux_event_state`) so a
 * restarted supervisor RESUMES. Subscribing at the live edge instead would look identical and silently skip
 * everything that happened while it was down. The cursor is this verb's OWN: it once shared a file with
 * `session watch`, and every drain here advanced that verb's cursor past events it had never folded
 * (`cmux/eventState/storePort.ts`).
 */

import { type CmuxEventStatePort, cmuxEventStatePort } from "../../../cmux/eventState/port.js";
import { openCmuxEventStream } from "../../../cmux/eventStream.js";
import { type CmuxEvent, type CmuxEventAck, SUPERVISION_EVENT_NAMES } from "../../../cmux/events.js";
import { deferred } from "../../../lib/deferred.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { cmuxUsage, numberFlag, parseCmuxArgs, repeatedFlag, stringFlag, VERB_ARG_OFFSET } from "./core.js";

/** How long a drain waits with no new frame before deciding it has caught up. */
const DRAIN_QUIET_MS = 750;

/**
 * The hard bound on a whole drain, however busy the fleet is.
 *
 * The quiet timer alone is NOT a bound: on a fleet where something fires every few hundred milliseconds it
 * re-arms forever and the drain never ends. Every wait loop in this repo has a ceiling, and this is this
 * one's — `--follow` is how a caller asks to stay subscribed, and it should be the only way.
 */
const DRAIN_DEADLINE_MS = 30_000;

/** Where an event happened: a hook fired outside any workspace carries no id, and the line says so. */
function eventWorkspaceLabel({ event }: { event: CmuxEvent }): string {
  const workspaceId = event.workspaceId;
  if (workspaceId === undefined) {
    return "(no workspace)";
  }
  return workspaceId;
}

/**
 * One event as the human-readable line a drain prints.
 *
 * @param event the event to render
 * @returns a tab-separated line leading with the sequence number a caller resumes from
 */
export function renderEventLine({ event }: { event: CmuxEvent }): string {
  const where = eventWorkspaceLabel({ event });
  const detail = event.toolName === undefined ? "" : `\t${event.toolName}`;
  return `${String(event.seq)}\t${event.occurredAtIso}\t${event.name}\t${where}${detail}`;
}

/** Everything the verb decided from its flags, before any socket is opened. */
interface EventsRequest {
  readonly afterSeq: number | undefined;
  readonly names: readonly string[];
  readonly categories: readonly string[];
  readonly workspaceId: string | undefined;
  readonly follow: boolean;
  readonly asJson: boolean;
  readonly limit: number | undefined;
  readonly home: string;
  /** The cursor row's revision the closing write pins to; null when no row exists yet. */
  readonly expectedRevision: number | null;
  readonly port: CmuxEventStatePort;
}

/** The cursor a gap warning says was requested: a drain given no starting seq asked from zero. */
function requestedCursorText({ request }: { request: EventsRequest }): string {
  const afterSeq = request.afterSeq;
  if (afterSeq === undefined) {
    return "0";
  }
  return String(afterSeq);
}

/** The oldest seq cmux still retains, as a gap warning quotes it: an ack that omits it is printed as zero. */
function oldestRetainedText({ ack }: { ack: CmuxEventAck }): string {
  const oldestSeq = ack.oldestSeq;
  if (oldestSeq === undefined) {
    return "0";
  }
  return String(oldestSeq);
}

/**
 * Run `cmux events` against this install's store.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxEvents(argv: readonly string[]): Promise<number> {
  return runCmuxEventsOver({ argv, port: cmuxEventStatePort() });
}

/**
 * Run `cmux events` over whichever cursor port it is handed — the store in production, an in-memory row in a test.
 *
 * @param argv the full process argv
 * @param port where the verb's own cursor is read and committed
 * @returns the process exit code
 */
export async function runCmuxEventsOver({
  argv,
  port,
}: {
  argv: readonly string[];
  port: CmuxEventStatePort;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: cmuxUsage({ verb: "events" }) });
    return EXIT_OK;
  }
  const parsed = parseCmuxArgs({ rest, verb: "events" });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: cmuxUsage({ verb: "events" }) });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const since = numberFlag({ name: "since", parsed: parsed.value });
  if ("error" in since) {
    logger.error({ msg: `cmux events: ${since.error}` });
    return EXIT_USAGE;
  }
  const limit = numberFlag({ name: "limit", parsed: parsed.value });
  if ("error" in limit) {
    logger.error({ msg: `cmux events: ${limit.error}` });
    return EXIT_USAGE;
  }
  const names = repeatedFlag({ name: "name", rest });
  // An explicit --since is the caller's own start, so the cursor file is never adopted around it.
  const cursor = await port.readEventsCursor({ home, importFile: since.value === undefined });
  if (cursor.isErr()) {
    logger.error({ msg: `cmux events: ${cursor.error.message}` });
    return EXIT_ERROR;
  }
  let afterSeq = cursor.value.cursorSeq;
  if (since.value !== undefined) {
    afterSeq = since.value;
  }
  return streamEvents({
    request: {
      afterSeq,
      asJson: parsed.value.values["json"] === true,
      categories: repeatedFlag({ name: "category", rest }),
      expectedRevision: cursor.value.revision,
      follow: parsed.value.values["follow"] === true,
      home,
      limit: limit.value,
      names: names.length > 0 ? names : [...SUPERVISION_EVENT_NAMES],
      port,
      workspaceId: stringFlag({ name: "workspace", parsed: parsed.value }),
    },
  });
}

/**
 * Open the subscription and print until the mode's own stopping condition.
 *
 * @param request the already-resolved request
 * @returns the process exit code
 */
// max-lines-exempt: one subscription's wiring around shared mutable state (the cursor, the printed count, the quiet timer) — every decision it makes is already a named helper or a pure function elsewhere.
async function streamEvents({ request }: { request: EventsRequest }): Promise<number> {
  const finished = deferred<number>();
  let printed = 0;
  // Advanced ONLY past events this drain actually handled, never to the ack's `latest_seq`. Measured by
  // using it: a `--limit 3` drain printed events around seq 102,690 and then recorded 104,498, because the
  // ack reports the live EDGE — so the next drain started past ~1,800 events nobody had seen. A cursor that
  // outruns the work it is a cursor FOR is worse than no cursor, because the skip is silent.
  // A drain given no starting seq has handled nothing yet, so its cursor starts at zero.
  let highestSeq = 0;
  if (request.afterSeq !== undefined) {
    highestSeq = request.afterSeq;
  }
  let quiet: ReturnType<typeof setTimeout> | undefined;
  // Set the moment the drain decides it is over, before the cursor commit it then awaits — so a frame or a timer
  // arriving during that commit neither prints nor finishes a second time.
  let stopped = false;

  const finish = ({ code, error }: { code: number; error: string | undefined }): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (quiet !== undefined) {
      clearTimeout(quiet);
    }
    if (deadline !== undefined) {
      clearTimeout(deadline);
    }
    stream.close();
    if (error !== undefined) {
      logger.error({ msg: `cmux events: ${error}` });
    }
    void (async (): Promise<void> => {
      const committed = await request.port.writeEventsCursor({
        cursorSeq: highestSeq,
        expectedRevision: request.expectedRevision,
        home: request.home,
        nowIso: new Date().toISOString(),
      });
      if (committed.isErr()) {
        logger.error({ msg: `cmux events: ${committed.error.message}` });
        finished.settle({ value: EXIT_ERROR });
        return;
      }
      finished.settle({ value: code });
    })();
  };

  const armQuietTimer = (): void => {
    if (quiet !== undefined) {
      clearTimeout(quiet);
    }
    quiet = setTimeout(() => {
      finish({ code: EXIT_OK, error: undefined });
    }, DRAIN_QUIET_MS);
  };

  const deadline = request.follow
    ? undefined
    : setTimeout(() => {
        finish({ code: EXIT_OK, error: undefined });
      }, DRAIN_DEADLINE_MS);

  const stream = openCmuxEventStream({
    handlers: {
      onAck: ({ ack }) => {
        if (ack.gap) {
          logger.error({
            msg: `cmux events: the requested cursor (${requestedCursorText({ request })}) had already aged out of cmux's retained buffer (oldest ${oldestRetainedText({ ack })}) — events were MISSED, not merely skipped`,
          });
        }
        if (!request.follow) {
          armQuietTimer();
        }
      },
      onEnd: ({ error }) => {
        finish({ code: error === undefined ? EXIT_OK : EXIT_ERROR, error: error?.message });
      },
      onEvent: ({ event }) => {
        // A single socket chunk routinely carries several frames, and this handler runs once per frame in
        // that chunk — so without this guard `--limit` overshoots by however many frames arrived together.
        // Measured live: `--limit 6` printed 9.
        if (stopped) {
          return;
        }
        highestSeq = Math.max(highestSeq, event.seq);
        if (request.workspaceId !== undefined && event.workspaceId !== request.workspaceId) {
          return;
        }
        logger.out({ line: request.asJson ? JSON.stringify(event) : renderEventLine({ event }) });
        printed += 1;
        if (request.limit !== undefined && printed >= request.limit) {
          finish({ code: EXIT_OK, error: undefined });
          return;
        }
        if (!request.follow) {
          armQuietTimer();
        }
      },
    },
    subscription: {
      ...(request.afterSeq === undefined ? {} : { afterSeq: request.afterSeq }),
      categories: request.categories,
      names: request.names,
    },
  });

  return finished.promise;
}

export const cmuxEventsCommand = defineCommand({ run: runCmuxEvents });
