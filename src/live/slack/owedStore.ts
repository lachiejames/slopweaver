/**
 * Persistence for the `slack owed` document: one file, replaced atomically on every `--write`, and read back
 * by a briefing through {@link readSlackOwedDocument}.
 *
 * A snapshot rather than a log, because a briefing wants the latest reading and nothing else. The atomic
 * replace is what keeps the previous complete file standing when a write fails part-way — a reader never
 * sees half a document. The path is `stateHomePaths`'s, never derived here.
 */

import { readFileSync } from "node:fs";

import type { IngestError } from "../../lib/ingestError.js";
import { err, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { writeFileAtomic } from "../../lib/writeAtomic.js";
import { stateHomePaths } from "../../stateHome.js";
import { parseSlackOwedDocument, renderSlackOwedJson, type SlackOwedDocument } from "./owedDocument.js";

/**
 * Atomically replace `live/slack/owed.json` under the given home with this document.
 *
 * @param document the document to persist
 * @param home the state home to write under
 * @returns the path written, or the typed filesystem error that stopped it
 */
export function writeSlackOwedDocument({
  document,
  home,
}: {
  document: SlackOwedDocument;
  home: string;
}): Result<{ readonly path: string }, IngestError> {
  const path = stateHomePaths({ home }).live.slack.owedJson;
  return safeFs({
    execute: () => {
      writeFileAtomic({ contents: `${renderSlackOwedJson({ document })}\n`, path });
      return { path };
    },
    operation: "writeSlackOwedDocument",
    path,
  });
}

/** No owed document stands under this home: `slack owed --write` has never succeeded here. */
export interface SlackOwedMissingError {
  readonly code: "SLACK_OWED_MISSING";
  readonly message: string;
  readonly path: string;
}

/** The owed document stands and would not read. */
export interface SlackOwedUnreadableError {
  readonly code: "SLACK_OWED_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: string;
}

/** The owed document read, and it is not JSON or not the strict document this build writes. */
export interface SlackOwedInvalidError {
  readonly code: "SLACK_OWED_INVALID";
  readonly message: string;
  readonly path: string;
  /** Every schema problem, never only the first. */
  readonly issues: readonly string[];
}

/** Every way reading the persisted owed document back can fail — never an empty document. */
export type SlackOwedStoreError = SlackOwedMissingError | SlackOwedUnreadableError | SlackOwedInvalidError;

/** Build each {@link SlackOwedStoreError} arm with its display message. */
export const SlackOwedStoreErrors = {
  invalid: ({ path, issues }: { path: string; issues: readonly string[] }): SlackOwedInvalidError => ({
    code: "SLACK_OWED_INVALID",
    issues,
    message: `${path} is not a slack owed document this build reads: ${issues.join("; ")}`,
    path,
  }),
  missing: ({ path }: { path: string }): SlackOwedMissingError => ({
    code: "SLACK_OWED_MISSING",
    message: `${path} is not there, so \`slack owed --write\` has never succeeded on this install`,
    path,
  }),
  unreadable: ({ path, cause }: { path: string; cause: string }): SlackOwedUnreadableError => ({
    cause,
    code: "SLACK_OWED_UNREADABLE",
    message: `${path} could not be read: ${cause}`,
    path,
  }),
} as const;

/**
 * Read `live/slack/owed.json` back under the given home, validated by the same strict schema the writer's
 * document satisfies. Read-only: a failed read leaves the file exactly as it was.
 *
 * @param home the state home to read under
 * @returns the document, or the typed refusal naming why there is none
 */
export function readSlackOwedDocument({ home }: { home: string }): Result<SlackOwedDocument, SlackOwedStoreError> {
  const path = stateHomePaths({ home }).live.slack.owedJson;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return err(SlackOwedStoreErrors.missing({ path }));
    }
    const cause = error instanceof Error ? error.message : String(error);
    return err(SlackOwedStoreErrors.unreadable({ cause, path }));
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: path, text });
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    return err(SlackOwedStoreErrors.invalid({ issues: [`not JSON: ${why}`], path }));
  }
  return parseSlackOwedDocument({ value }).mapErr((issues) => SlackOwedStoreErrors.invalid({ issues, path }));
}
