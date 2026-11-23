/**
 * The GitHub review-draft register's effectful edge: append an event, read the log back, mint an id.
 *
 * Thin on purpose, as `./slackDraftStore.ts` is: every decision lives in `../outbound/github/reviewDraft.ts`.
 * The log is `$SLOPWEAVER_HOME/queue/github-review-drafts.jsonl`, written `0600` inside a `0700` directory,
 * because it holds a review under the owner's name that the owner has not decided to post.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { isAbsentError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { type ReviewDraftEvent, reviewDraftEventLine } from "../outbound/github/reviewDraft.js";
import { type ReviewDraftError, ReviewDraftErrors } from "../outbound/github/reviewDraftErrors.js";
import { stateHomePaths } from "../stateHome.js";

/** The register's filename under `$SLOPWEAVER_HOME/queue`. */
const REVIEW_DRAFT_FILE = "github-review-drafts.jsonl";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * The register's absolute path.
 *
 * @param home the state home
 * @returns the path to `github-review-drafts.jsonl`
 */
export function reviewDraftLogPath({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).queue, REVIEW_DRAFT_FILE);
}

/**
 * Mint an id for a parked review. Short so it can be retyped off the card; `rd-` so it is never mistaken for an
 * `sd-` Slack draft beside it.
 *
 * @returns the id, prefixed `rd-`
 */
export function mintReviewDraftId(): string {
  return `rd-${randomUUID().slice(0, 8)}`;
}

/**
 * Append one event, creating the directory if needed.
 *
 * @param event the event to append
 * @param home the state home
 * @returns `true`, or why the register could not be written
 */
export function appendReviewDraftEvent({
  event,
  home,
}: {
  event: ReviewDraftEvent;
  home: string;
}): Result<true, ReviewDraftError> {
  const dir = stateHomePaths({ home }).queue;
  const path = join(dir, REVIEW_DRAFT_FILE);
  try {
    mkdirSync(dir, { mode: DIR_MODE, recursive: true });
    appendLines({ mode: FILE_MODE, path, text: `${reviewDraftEventLine({ event })}\n` });
  } catch (cause: unknown) {
    return err(ReviewDraftErrors.writeFailed({ cause, path }));
  }
  return ok(true);
}

/**
 * Read the register line by line. An absent log — a home that has never parked a review — is no lines; a log
 * that exists and cannot be read is an error, because an empty answer would hide every review the owner is owed. Absence is
 * judged off the read's own failure rather than `existsSync`, which also answers false for a log it may not reach
 *
 *
 * @param home the state home
 * @returns every line in file order, or why the log could not be read
 */
export function readReviewDraftLines({ home }: { home: string }): Result<readonly string[], ReviewDraftError> {
  const path = reviewDraftLogPath({ home });
  const lines: string[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        lines.push(line);
      },
      path,
    });
  } catch (cause: unknown) {
    if (isAbsentError({ error: cause, path })) {
      return ok([]);
    }
    return err(ReviewDraftErrors.readFailed({ cause, path }));
  }
  return ok(lines);
}
