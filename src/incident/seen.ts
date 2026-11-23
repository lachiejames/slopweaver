/**
 * The incident channels whose board row exists — so the five-minute sweep registers each live incident ONCE, however
 * many sweeps see its channel inside the live window.
 *
 * One append-only `incidents/seen.jsonl` under the state home. A row is written only once the board row is known to
 * exist: this sweep created it, or an earlier sweep (or one that won a create race) already had. A channel that was
 * skipped writes nothing, so the next sweep tries it again — a refusal is never remembered as a success.
 *
 * An ABSENT ledger is empty: the first sweep on a fresh install sees no channel as registered, and the live window is
 * what keeps that first sweep from reaching back past the incidents that are actually live. A PRESENT ledger that will
 * not read refuses, because reading it as empty would register every live incident a second time.
 */
import { mkdirSync, statSync } from "node:fs";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { appendLines } from "../lib/appendSeparator.js";
import { errorMessage } from "../lib/errorMessage.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonStringify } from "../lib/safeJson.js";
import { stateHomePaths } from "../stateHome.js";
import { type IncidentLedgerError, IncidentLedgerErrors } from "./errors.js";

/** Owner-only permissions, matching every other ledger under the state home. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** How the board row came to exist. */
const SEEN_OUTCOMES = ["created", "created-incomplete", "already-existed"] as const;

/** One of {@link SEEN_OUTCOMES}. */
export type SeenOutcome = (typeof SEEN_OUTCOMES)[number];

/** One incident channel whose board row exists. */
export interface SeenRow {
  readonly channelId: string;
  readonly slug: string;
  readonly outcome: SeenOutcome;
  readonly atIso: string;
}

/**
 * Parse one ledger line.
 *
 * @param line the raw line
 * @param lineNumber which line it was, for the refusal
 * @returns the row, or why the line is not one
 */
export function parseSeenRow({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<SeenRow, IncidentLedgerError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return err(IncidentLedgerErrors.corrupt({ lineNumber, why: "it is not JSON" }));
  }
  if (!isRecord(parsed)) {
    return err(IncidentLedgerErrors.corrupt({ lineNumber, why: "it is not a JSON object" }));
  }
  const { channelId, slug, outcome, atIso } = parsed;
  const knownOutcome = SEEN_OUTCOMES.find((one) => one === outcome);
  if (
    typeof channelId !== "string" ||
    typeof slug !== "string" ||
    typeof atIso !== "string" ||
    knownOutcome === undefined
  ) {
    return err(
      IncidentLedgerErrors.corrupt({
        lineNumber,
        why: `a seen row carries a channelId, a slug, an atIso and an outcome of ${SEEN_OUTCOMES.join(" | ")}`,
      }),
    );
  }
  return ok({ atIso, channelId, outcome: knownOutcome, slug });
}

/**
 * Every channel id the ledger records as registered.
 *
 * @param home the state home
 * @returns the ids, empty when the ledger is absent, or the failure
 */
export function readSeenChannelIds({ home }: { home: string }): Result<ReadonlySet<string>, IncidentLedgerError> {
  const path = stateHomePaths({ home }).incidentsSeenJsonl;
  try {
    statSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return ok(new Set());
    }
    return err(IncidentLedgerErrors.unreadable({ cause: errorMessage({ error }), path }));
  }
  const ids = new Set<string>();
  let corrupt: IncidentLedgerError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (corrupt !== undefined || line.trim().length === 0) {
          return;
        }
        const row = parseSeenRow({ line, lineNumber: index + 1 });
        if (row.isErr()) {
          corrupt = row.error;
          return;
        }
        ids.add(row.value.channelId);
      },
      path,
    });
  } catch (cause) {
    return err(IncidentLedgerErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  if (corrupt !== undefined) {
    return err(corrupt);
  }
  return ok(ids);
}

/**
 * Record that a channel's board row exists.
 *
 * @param row the channel, its slug, how the row came to exist, and when
 * @param home the state home
 * @returns the ledger's path, or the failure
 */
export function appendSeenRow({ row, home }: { row: SeenRow; home: string }): Result<string, IncidentLedgerError> {
  const paths = stateHomePaths({ home });
  const path = paths.incidentsSeenJsonl;
  const detached = { ...row };
  Object.setPrototypeOf(detached, null);
  try {
    mkdirSync(paths.incidents, { mode: DIR_MODE, recursive: true });
    appendLines({
      mode: FILE_MODE,
      path,
      text: `${safeJsonStringify({ label: "an incidents seen row", value: detached })}\n`,
    });
  } catch (cause) {
    return err(IncidentLedgerErrors.unreadable({ cause: errorMessage({ error: cause }), path }));
  }
  return ok(path);
}
