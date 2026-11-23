/**
 * The as-me draft register's effectful edge: append an event, read the log back, mint an id.
 *
 * Thin on purpose, exactly as `./queueStore.ts` is, and for the same reason: every decision lives in
 * `../outbound/slack/draftRegister.ts`, which is pure and testable by calling it. What is here is the
 * filesystem and the two non-deterministic values, both injectable from above.
 *
 * The log is `$SLOPWEAVER_HOME/queue/slack-drafts.jsonl` — beside the withheld-reply log rather than inside
 * it. It holds a message the owner has not sent yet, which is content nothing else may read, so it is
 * written `0600` inside a `0700` directory.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { isAbsentError } from "#lib/presentFile.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { draftDeletionIds } from "../outbound/slack/draftDeletion.js";
import { type SlackDraftError, SlackDraftErrors } from "../outbound/slack/draftErrors.js";
import { parseSlackDraftLog } from "../outbound/slack/draftLog.js";
import { type SlackDraftEvent, slackDraftEventLine } from "../outbound/slack/draftRegister.js";
import { stateHomePaths } from "../stateHome.js";
import { CALL_LOCK_WAIT_MS, holdCallLock } from "../talk/callLock.js";
import { processStartOf } from "../talk/relayLease.js";

/** The register's filename under `$SLOPWEAVER_HOME/queue`. */
const DRAFT_FILE = "slack-drafts.jsonl";

/** Owner-only permissions: the log holds a message the owner has not decided to send. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The register's absolute path.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns the path to `slack-drafts.jsonl`
 */
export function slackDraftLogPath({ home }: { home?: string } = {}): string {
  return join(stateHomePaths(home === undefined ? {} : { home }).queue, DRAFT_FILE);
}

/**
 * Mint an id for a parked draft.
 *
 * Short for the same reason a queue id is: the owner reads a draft on one surface and acts on it on another, and
 * `slopweaver slack draft show sd-1a2b3c4d` has to be retypable. The `sd-` prefix keeps it distinguishable
 * from a `q-` withheld reply at a glance, which matters because the two registers sit side by side.
 *
 * @returns the id, prefixed `sd-`
 */
export function mintSlackDraftId(): string {
  return `sd-${randomUUID().slice(0, 8)}`;
}

/**
 * Append one event to the register, creating the directory if needed.
 *
 * Returns a `Result` rather than throwing because the caller's whole contract is "nothing was sent": a
 * write that failed has to be reported as a draft that was NOT parked, not as one the owner will later
 * look for and never find.
 *
 * @param event the event to append
 * @param home the state home (defaults to the resolved home)
 * @returns nothing on success, or why the register could not be written
 */
export function appendSlackDraftEvent({
  event,
  home,
}: {
  event: SlackDraftEvent;
  home?: string;
}): Result<true, SlackDraftError> {
  const dir = stateHomePaths(home === undefined ? {} : { home }).queue;
  const path = join(dir, DRAFT_FILE);
  try {
    mkdirSync(dir, { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${slackDraftEventLine({ event })}\n` });
  } catch (cause: unknown) {
    return err(SlackDraftErrors.writeFailed({ cause, path }));
  }
  return ok(true);
}

/**
 * Take the register's write lock, `slack-drafts.jsonl.lock` beside it, for one verb's read, check and append — or say
 * that a live writer held it past the wait. A judgement, a drop and a re-cut each decide off a read, and a drop is
 * terminal: checked after its append, an approve landing in between was found only by a read-back the dropping
 * process might never reach. Under the lock the read IS the state the append lands on.
 *
 * @param home the state home
 * @param waitMs how long to wait for another verb, 10 s unless a test narrows it
 * @returns what releases the lock, or why it could not be taken
 */
export function holdSlackDraftLock({
  home,
  waitMs = CALL_LOCK_WAIT_MS,
}: {
  home: string;
  waitMs?: number;
}): Result<() => void, SlackDraftError> {
  const dir = stateHomePaths({ home }).queue;
  const path = join(dir, DRAFT_FILE);
  try {
    mkdirSync(dir, { mode: DIR_MODE, recursive: true });
    return ok(
      holdCallLock({ path, pid: process.pid, startOf: (candidate) => processStartOf({ pid: candidate }), waitMs }),
    );
  } catch (cause: unknown) {
    return err(SlackDraftErrors.writeFailed({ cause, path: `${path}.lock` }));
  }
}

/**
 * Read the register line by line. An absent log — a home that has never parked a draft — is no lines, not
 * an error; a log that exists and cannot be read is not swallowed.
 *
 * A `.jsonl` has no ceiling, so this goes through the corpus reader rather than pulling the whole file into
 * one string: the register grows by an event per draft recorded, released and dropped, forever.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns every line in file order, or none when there is no log yet
 */
export function readSlackDraftLines({ home }: { home?: string } = {}): readonly string[] {
  const lines: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        lines.push(line);
      },
      path: slackDraftLogPath(home === undefined ? {} : { home }),
    });
  } catch {
    return [];
  }
  return lines;
}

/**
 * Read the register line by line, saying when it could not be read. An absent log is no lines; a log that exists and
 * would not read is an error, because a reader deciding "nothing was held" must not decide it off a read that failed
 * (`talk slack-send-outcome`).
 *
 * @param home the state home (defaults to the resolved home)
 * @returns every line in file order, none when there is no log yet, or why the log would not read
 */
export function readSlackDraftLinesOrError({ home }: { home?: string } = {}): Result<
  readonly string[],
  SlackDraftError
> {
  const path = slackDraftLogPath(home === undefined ? {} : { home });
  const lines: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        lines.push(line);
      },
      path,
      // A byte that is not UTF-8 delivers a line no parser takes, so it is passed over, never read repaired.
      strictUtf8: true,
    });
  } catch (cause: unknown) {
    // The read decides absence, never `existsSync`: that answers false for a log behind an unsearchable directory too.
    if (isAbsentError({ error: cause, path })) {
      return ok([]);
    }
    return err(SlackDraftErrors.registerUnreadable({ cause, path }));
  }
  return ok(lines);
}

/**
 * Journal that the message at `channel`/`ts` was deleted, on every row whose release landed there and that carries no
 * such event yet — read, decided and appended under the register lock, so a retry after a partial append adds only
 * what is missing. A line that does not read never blocks it: the delete already happened, and at worst it costs a
 * duplicate `deleted` line, which every reader treats as the first.
 *
 * @param home the state home
 * @param channel the deleted message's channel
 * @param ts the deleted message's own Slack `ts`
 * @param nowIso the instant the deletion is journalled at
 * @returns the ids journalled, empty when no row released there or all were already journalled, or why it could not
 */
export function journalSlackDraftDeletion({
  home,
  channel,
  ts,
  nowIso,
}: {
  home: string;
  channel: string;
  ts: string;
  nowIso: string;
}): Result<readonly string[], SlackDraftError> {
  const lock = holdSlackDraftLock({ home });
  if (lock.isErr()) {
    return err(lock.error);
  }
  try {
    const lines = readSlackDraftLinesOrError({ home });
    if (lines.isErr()) {
      return err(lines.error);
    }
    const ids = draftDeletionIds({ channel, events: parseSlackDraftLog({ lines: lines.value }).events, ts });
    for (const id of ids) {
      const appended = appendSlackDraftEvent({ event: { channel, id, kind: "deleted", ts, tsIso: nowIso }, home });
      if (appended.isErr()) {
        return err(appended.error);
      }
    }
    return ok(ids);
  } finally {
    lock.value();
  }
}
