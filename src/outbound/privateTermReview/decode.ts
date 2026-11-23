/**
 * THE PRIVATE-WORDS REVIEW, its records read back: a hold, a receipt or a preparation decoded field by field from
 * the JSON `./store.ts` wrote, so a record edited on disk into any other shape reads as no record at all. Pure.
 *
 * A hold's key is not checked here: `./store.ts` re-hashes the decoded hold, so an edit that keeps the shape but
 * changes a value is refused there.
 */
import { isRecord } from "#lib/parsers.js";

import { PRIVATE_TERM_CLASSES, type PrivateTermClass } from "../../hygiene/privateTerms.js";
import { parseVisibleSession, type VisibleSupervisorSession } from "../../supervisor/session.js";
import type {
  PrivateTermHeldContent,
  PrivateTermHeldMatch,
  PrivateTermHeldTerm,
  PrivateTermHold,
  PrivateTermReviewPreparation,
  PrivateTermReviewReceipt,
  PrivateTermWriteFamily,
} from "./types.js";

/** Every write family a hold can name. */
const WRITE_FAMILIES: readonly PrivateTermWriteFamily[] = [
  "github",
  "slack",
  "linear",
  "notion",
  "google-calendar",
  "gmail",
];

/** A recorded session, or null; undefined when the value is neither. */
function sessionOrNull({ value }: { value: unknown }): VisibleSupervisorSession | null | undefined {
  if (value === null) {
    return null;
  }
  return parseVisibleSession({ value });
}

/** One class from the closed set, or undefined. */
function classOf({ value }: { value: unknown }): PrivateTermClass | undefined {
  return PRIVATE_TERM_CLASSES.find((known) => known === value);
}

/** Every element of an array decoded, or undefined when it is no array or any one element does not decode. */
function everyOf<T>({
  values,
  decode,
}: {
  values: unknown;
  decode: (args: { value: unknown }) => T | undefined;
}): readonly T[] | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  const decoded: T[] = [];
  for (const value of values) {
    const one = decode({ value });
    if (one === undefined) {
      return undefined;
    }
    decoded.push(one);
  }
  return decoded;
}

/** One held string and its locus. */
function contentOf({ value }: { value: unknown }): PrivateTermHeldContent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { locus, text } = value;
  if (typeof locus !== "string" || typeof text !== "string") {
    return undefined;
  }
  return { locus, text };
}

/** One match, by its offsets. */
function matchOf({ value }: { value: unknown }): PrivateTermHeldMatch | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { content, end, line, start, termId } = value;
  const className = classOf({ value: value["className"] });
  if (
    typeof content !== "number" ||
    typeof end !== "number" ||
    typeof line !== "number" ||
    typeof start !== "number" ||
    typeof termId !== "string" ||
    className === undefined
  ) {
    return undefined;
  }
  return { className, content, end, line, start, termId };
}

/** One matched row as the hold saw it; an absent allowed-where is the row naming nowhere. */
function termOf({ value }: { value: unknown }): PrivateTermHeldTerm | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { allowedWhere, meaning, rowDigest, termId } = value;
  const className = classOf({ value: value["className"] });
  if (
    typeof meaning !== "string" ||
    typeof rowDigest !== "string" ||
    typeof termId !== "string" ||
    className === undefined ||
    (allowedWhere !== undefined && typeof allowedWhere !== "string")
  ) {
    return undefined;
  }
  return {
    allowedWhere: typeof allowedWhere === "string" ? allowedWhere : undefined,
    className,
    meaning,
    rowDigest,
    termId,
  };
}

/**
 * Pure: a hold record decoded, its key left for the store to re-hash.
 *
 * @param value the parsed JSON of one hold file
 * @returns the hold, or undefined when any field is missing or of another shape
 */
export function decodeHold({ value }: { value: unknown }): PrivateTermHold | undefined {
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    return undefined;
  }
  const { command, createdAtIso, destination, holdId, holdKey, requestSha256 } = value;
  const family = WRITE_FAMILIES.find((known) => known === value["family"]);
  const contents = everyOf({ decode: contentOf, values: value["contents"] });
  const matches = everyOf({ decode: matchOf, values: value["matches"] });
  const terms = everyOf({ decode: termOf, values: value["terms"] });
  const heldBy = sessionOrNull({ value: value["heldBy"] });
  if (
    typeof command !== "string" ||
    typeof createdAtIso !== "string" ||
    typeof destination !== "string" ||
    typeof holdId !== "string" ||
    typeof holdKey !== "string" ||
    typeof requestSha256 !== "string" ||
    family === undefined ||
    contents === undefined ||
    matches === undefined ||
    terms === undefined ||
    heldBy === undefined
  ) {
    return undefined;
  }
  return {
    command,
    contents,
    createdAtIso,
    destination,
    family,
    heldBy,
    holdId,
    holdKey,
    matches,
    requestSha256,
    schemaVersion: 1,
    terms,
  };
}

/**
 * Pure: a receipt record decoded.
 *
 * @param value the parsed JSON of one receipt file
 * @returns the receipt, or undefined when any field is missing or of another shape
 */
export function decodeReceipt({ value }: { value: unknown }): PrivateTermReviewReceipt | undefined {
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    return undefined;
  }
  const { holdId, holdKey, preparationId, receiptId, recordedAtIso, reviewer, reviewId, summary, verdict } = value;
  const recordedBy = sessionOrNull({ value: value["recordedBy"] });
  if (
    typeof holdId !== "string" ||
    typeof holdKey !== "string" ||
    typeof preparationId !== "string" ||
    typeof receiptId !== "string" ||
    typeof recordedAtIso !== "string" ||
    typeof reviewId !== "string" ||
    typeof summary !== "string" ||
    (reviewer !== "codex" && reviewer !== "claude-fallback") ||
    (verdict !== "CLEAN" && verdict !== "BROKEN") ||
    recordedBy === undefined
  ) {
    return undefined;
  }
  return {
    holdId,
    holdKey,
    preparationId,
    receiptId,
    recordedAtIso,
    recordedBy,
    reviewer,
    reviewId,
    schemaVersion: 1,
    summary,
    verdict,
  };
}

/**
 * Pure: a preparation record decoded.
 *
 * @param value the parsed JSON of one `preparation.json`
 * @returns the preparation, or undefined when any field is missing or of another shape
 */
export function decodePreparation({ value }: { value: unknown }): PrivateTermReviewPreparation | undefined {
  if (!isRecord(value) || value["schemaVersion"] !== 1) {
    return undefined;
  }
  const { baseSha, createdAtIso, headSha, holdId, holdKey, preparationId } = value;
  const preparedBy = sessionOrNull({ value: value["preparedBy"] });
  if (
    typeof baseSha !== "string" ||
    typeof createdAtIso !== "string" ||
    typeof headSha !== "string" ||
    typeof holdId !== "string" ||
    typeof holdKey !== "string" ||
    typeof preparationId !== "string" ||
    preparedBy === undefined
  ) {
    return undefined;
  }
  return { baseSha, createdAtIso, headSha, holdId, holdKey, preparationId, preparedBy, schemaVersion: 1 };
}
