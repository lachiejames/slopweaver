/**
 * The withheld-reply queue's effectful edge: append an event, read the log back, mint an id.
 *
 * Thin on purpose — every decision lives in `./queue.ts`, which is pure and testable by calling it. What is
 * here is the filesystem and the two non-deterministic values (the clock and the id), and both of those are
 * injectable so the layer above can be driven without either.
 *
 * The log is `$SLOPWEAVER_HOME/queue/withheld.jsonl`. It holds a colleague's question and the bot's draft
 * answer, which is content the door ledger deliberately never records — so this file is written `0600` inside
 * a `0700` directory, the same treatment `live/slack/thread-files` gets for the same reason.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { errorMessage } from "#lib/errorMessage.js";
import { isAbsentError, nonBlockingFileBytes } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { type QueueEvent, queueEventLine } from "./queue.js";

/** The queue log's filename under `$SLOPWEAVER_HOME/queue`. */
const QUEUE_FILE = "withheld.jsonl";

/** Owner-only permissions: the log holds a question and a draft answer, which nothing else may read. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The queue log's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `withheld.jsonl`
 */
export function queueLogPath({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).queue, QUEUE_FILE);
}

/**
 * Mint an id for a held draft.
 *
 * Short enough to retype into `slopweaver queue release <id>` from a phone, which is the actual use: the
 * owner reads a held notice in Slack and wants to act on it without opening a laptop. A uuid's first block is
 * 16 bits shy of a full uuid and still leaves a collision vanishingly unlikely inside one queue.
 *
 * @returns the id, prefixed `q-`
 */
export function mintQueueId(): string {
  return `q-${randomUUID().slice(0, 8)}`;
}

/**
 * Append one event to the queue log, creating the directory if needed.
 *
 * @param event the event to append
 * @param home the state home (defaults to the resolved home)
 */
export function appendQueueEvent({ event, home }: { event: QueueEvent; home?: string }): void {
  const dir = stateHomePaths(home === undefined ? {} : { home }).queue;
  mkdirSync(dir, { mode: DIR_MODE, recursive: true });
  appendLines({ mode: FILE_MODE, path: join(dir, QUEUE_FILE), text: `${queueEventLine({ event })}\n` });
}

/**
 * Read the queue log's raw text. An absent log — a home that has never withheld anything — is the empty
 * string, not an error.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the log contents, or `""` when there is no log yet
 */
export function readQueueText({ home }: { home?: string } = {}): string {
  try {
    return readFileSync(queueLogPath(home === undefined ? {} : { home }), "utf8");
  } catch {
    return "";
  }
}

/** The queue log exists and would not read. */
export interface QueueUnreadableError {
  readonly code: "QUEUE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** Builds the queue store's read failure. */
const QueueStoreErrors = {
  unreadable: ({ cause, path }: { cause: unknown; path: string }): QueueUnreadableError => ({
    code: "QUEUE_UNREADABLE",
    message: `the held-reply queue at ${path} would not read: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;

/**
 * The queue log's raw text, refusing a log that exists and will not read — {@link readQueueText} answers `""` for
 * that too, which a reader deciding "nothing is held" must not decide off (`handover currency`'s card read). Opened
 * non-blocking, so a pipe at the path is refused rather than hanging the reading.
 *
 * @param home the state home
 * @returns the log contents, `""` when there is no log yet, or why it would not read
 */
export function readQueueTextOrError({ home }: { home: string }): Result<string, QueueUnreadableError> {
  const path = queueLogPath({ home });
  try {
    return ok(nonBlockingFileBytes({ path }).toString("utf8"));
  } catch (cause: unknown) {
    if (isAbsentError({ error: cause, path })) {
      return ok("");
    }
    return err(QueueStoreErrors.unreadable({ cause, path }));
  }
}
