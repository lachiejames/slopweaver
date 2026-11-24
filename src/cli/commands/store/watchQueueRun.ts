/**
 * `slopweaver store watch-queue` — what the console Queue hears from the store, from a terminal: a `LISTEN` on the
 * channel the notify triggers (`store/schema/queueChangeNotify.ts`) send on, one line per event, until SIGINT or
 * SIGTERM ends it or the store stops answering. The console holds the same `LISTEN` in its own server process
 * (`site/lib/storeQueuePostgres.ts`) and never runs this verb; a person runs it to see what the Queue is told.
 */
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import { connectStore } from "../../../store/client.js";
import {
  missingQueueTriggersIn,
  QUEUE_WATCH_HEARTBEAT_MS,
  type QueueWatchLine,
  queueWatchLineText,
  watchQueueChanges,
} from "../../../store/queueChangeWatch.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { directoryFlag } from "./transferArgs.js";
import { fail, refuse, resolvedHome } from "./verbShell.js";
import { STORE_WATCH_QUEUE_USAGE } from "./watchQueueUsage.js";

/** `store watch-queue`'s flags. */
const STORE_WATCH_QUEUE_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

/**
 * Parse `store watch-queue`'s arguments.
 *
 * @param rest the argv after the verb
 * @returns the home and whether to print JSON, or every refusal
 */
export function parseStoreWatchQueueArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string | undefined; json: boolean }> {
  return parseFlags({ args: rest, spec: STORE_WATCH_QUEUE_FLAGS }).andThen(({ values }) =>
    directoryFlag({ name: "home", required: false, values, verb: "watch-queue" })
      .mapErr((error) => [error.message])
      .map((home) => ({ home, json: values["json"] === true })),
  );
}

/**
 * Run `store watch-queue`.
 *
 * @param argv the full process argv
 * @returns the process exit code: 0 when stopped by a signal, 3 when the store lacks a trigger, 1 when it stopped answering
 */
export async function runStoreWatchQueue(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "watch-queue" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STORE_WATCH_QUEUE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreWatchQueueArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: parsed.error, usage: STORE_WATCH_QUEUE_USAGE });
  }
  const { json } = parsed.value;
  const emit = (line: QueueWatchLine): void => {
    logger.out({ line: queueWatchLineText({ json, line }) });
  };
  const opened = await connectStore({ home: resolvedHome({ home: parsed.value.home }) });
  if (opened.isErr()) {
    return fail({ lines: [`store watch-queue: ${opened.error.message}`] });
  }
  const client = opened.value;
  const stop = new AbortController();
  const onSignal = (): void => {
    stop.abort();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const missing = await missingQueueTriggersIn({ client });
    if (missing.length > 0) {
      emit({ kind: "not-ready", missing });
      return EXIT_EXPECTED_EMPTY;
    }
    const ended = await watchQueueChanges({ client, emit, heartbeatMs: QUEUE_WATCH_HEARTBEAT_MS, signal: stop.signal });
    return ended.isErr() ? fail({ lines: ended.error.map((line) => `store watch-queue: ${line}`) }) : EXIT_OK;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await client.close();
  }
}

export const storeWatchQueueCommand = defineCommand({ run: runStoreWatchQueue });
